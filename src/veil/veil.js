import * as THREE from 'three'
import { ClothSim } from './physics.js'

// Translucent red silk. A two-sided sheen + a backlight term make the gauze
// glow where the light passes through it; edges dissolve so there is no hard
// rectangle. Overlapping folds stack in alpha and deepen the red on their own.
const VERTEX = `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const FRAGMENT = `
precision highp float;

uniform vec3  uLightDir;
uniform vec3  uColorDeep;
uniform vec3  uColorLit;
uniform vec3  uSheen;
uniform vec3  uSpec;
uniform float uBaseAlpha;
uniform float uShininess;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;          // make it two-sided

  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);

  float wrap    = dot(N, L) * 0.5 + 0.5;             // soft wrapped diffuse
  float NdotV   = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - NdotV, 2.2);             // rim / edge glow — softer, broader falloff
  float spec    = pow(clamp(dot(N, H), 0.0, 1.0), uShininess);
  float trans   = pow(clamp(dot(V, -L), 0.0, 1.0), 2.0) * (1.0 - NdotV);

  // Dissolve the four borders so the veil has no hard edge. A wide falloff
  // keeps the transmitting edge gentle now that the body is more opaque.
  float edge =
    smoothstep(0.0, 0.36, vUv.x) * smoothstep(1.0, 0.64, vUv.x) *
    smoothstep(0.0, 0.36, vUv.y) * smoothstep(1.0, 0.64, vUv.y);
  edge = smoothstep(0.0, 1.0, edge); // ease the curve so the fade has no kink

  // All the ADDITIVE glow (rim, satin, backlight) is gated by the edge fade so
  // the free boundary can't blow out into bright flame-tip spikes — the glow is
  // suppressed exactly in the dissolve zone where those teeth would form.
  vec3 col = mix(uColorDeep, uColorLit, wrap);
  col += uSheen * fresnel * 0.45 * edge;  // luminous edges — toned down
  col += uSpec * spec * 0.6 * edge;       // satin glint
  col += uColorLit * trans * 0.22 * edge; // faint backlight — no flame tips

  // Alpha is dominated by the body opacity so the front fold layer wins the
  // blend (less see-through layering ⇒ far less transparency moiré), and there
  // is NO grazing boost — that boost is what turned fold silhouettes into the
  // combed slivers of bright teeth.
  float alpha = clamp(uBaseAlpha + spec * 0.15 * edge, 0.0, 0.99);
  alpha *= edge;

  gl_FragColor = vec4(col, alpha);
}
`

const SETTINGS = {
  desktop: { cols: 84, rows: 56 },
  mobile: { cols: 46, rows: 32 },
}

// Physics tuning — big, slow silk folds on a black void.
// High wind strength + low wind speed = large, lazy billows. Low flatten lets
// the z-folds actually grow instead of being ironed back to a flat plane.
const SIM = {
  windStrength: 1.5, // the main driver — billows the free cloth into big folds
  windSpeed: 0.13, // slow, dreamy flow
  gravity: 0.09, // a little weight → the cloth drapes and folds asymmetrically
  damping: 0.985,
  recenter: 1.1, // pulls the whole MASS back to centre — shape stays free
  tumble: 0.16, // slow rotational drift so the folds roll over and tumble
  floatZ: 0.0, // depth the mass hovers at
  sway: 0.3, // the centre target roams a little, so it drifts as it tumbles
  stiffness: 0.85, // floppy → thin fabric folds into deep, soft creases
  iterations: 6, // extra relax passes keep the floppy cloth from over-stretching
  wrinkle: 0.07, // very faint crease — less faceting for the normals to comb
  curl: 0.3, // edges flip and curl — kept low so the rim doesn't comb into spikes
  // Containment: a SOFT disc around the cloth's own centre. The mass is eased
  // back when it spreads past containR, keeping it a contained, tumbling clump
  // without the hard edge-crease a snap clamp produced.
  containR: 0.5,
  containZ: 1.0, // free to fold deep toward/away from the camera
  boundary: 5.0, // how firmly the soft disc reins the mass back in
  edgeSmooth: 0.5, // iron the free border's sawtooth pucker (0 = off)
  edgeSmoothPasses: 2, // how many smoothing passes along each edge per frame
}

// Reveal — the silk enters as a tall, narrow vertical ribbon of red down the
// centre, then unfurls sideways into the full tumbling mass. Per-axis scale:
// starts thin in X, slightly over-tall in Y, flat in Z; eases to (1,1,1).
const REVEAL = {
  duration: 3.2, // seconds
  start: { x: 0.1, y: 1.18, z: 0.1 },
}
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

export function initVeil(canvas) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
  } catch (e) {
    canvas.style.background =
      'radial-gradient(120% 90% at 40% 30%, #7d0a18, #2a0309 60%, #160206)'
    return () => {}
  }

  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 5)

  const isMobile = Math.min(window.innerWidth, window.innerHeight) < 640
  const { cols, rows } = isMobile ? SETTINGS.mobile : SETTINGS.desktop

  // Sheet sized to a contained mass that floats in the middle of the view —
  // not a full-bleed drape.
  const sheetW = 3.6
  const sheetH = 2.7
  const sim = new ClothSim({ cols, rows, width: sheetW, height: sheetH })

  // --- geometry: positions stream from the sim, indices/uv are static ---
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(sim.count * 3)
  const uvs = new Float32Array(sim.count * 2)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i
      uvs[n * 2] = i / (cols - 1)
      uvs[n * 2 + 1] = 1 - j / (rows - 1)
    }
  }
  const indices = []
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uLightDir: { value: new THREE.Vector3(-0.5, 0.8, 0.7).normalize() },
      uColorDeep: { value: new THREE.Color(0x4a0612) },
      uColorLit: { value: new THREE.Color(0xe0202e) },
      uSheen: { value: new THREE.Color(0xe9a24a).multiplyScalar(0.5) },
      uSpec: { value: new THREE.Color(0xffd9a0).multiplyScalar(0.45) },
      uBaseAlpha: { value: 0.88 },
      uShininess: { value: 18.0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  })

  const mesh = new THREE.Mesh(geometry, material)
  scene.add(mesh)

  const reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  window.addEventListener('resize', resize)
  resize()

  const posAttr = geometry.getAttribute('position')
  const baseAlpha = material.uniforms.uBaseAlpha.value
  let raf = 0
  let elapsed = 0

  // Start as a thin vertical ribbon down the centre; the loop unfurls it wide.
  if (reduceMotion) {
    mesh.scale.set(1, 1, 1)
  } else {
    mesh.scale.set(REVEAL.start.x, REVEAL.start.y, REVEAL.start.z)
    material.uniforms.uBaseAlpha.value = 0
  }

  function frame() {
    if (!reduceMotion) {
      elapsed += 1 / 60
      const t = Math.min(1, elapsed / REVEAL.duration)
      const e = easeOutCubic(t)
      mesh.scale.set(
        REVEAL.start.x + (1 - REVEAL.start.x) * e,
        REVEAL.start.y + (1 - REVEAL.start.y) * e,
        REVEAL.start.z + (1 - REVEAL.start.z) * e
      )
      material.uniforms.uBaseAlpha.value = baseAlpha * e

      sim.update(1 / 60, SIM)
    }

    // Stream sim positions into the geometry, then rebuild normals.
    posAttr.array.set(sim.pos)
    posAttr.needsUpdate = true
    geometry.computeVertexNormals()

    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }
  // Settle the cloth for a few steps so it opens on a graceful drape.
  for (let i = 0; i < 40; i++) sim.update(1 / 60, SIM)
  raf = requestAnimationFrame(frame)

  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
    geometry.dispose()
    material.dispose()
    renderer.dispose()
  }
}
