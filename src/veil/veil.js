import * as THREE from "three";

// Translucent red silk driven by ANALYTIC waves instead of a physics solver.
//
// The old Verlet cloth sim buckled under its containment forces into
// grid-scale accordion pleats — real zigzag geometry that rendered as combs of
// triangular teeth no amount of shading/antialiasing could hide. A summed
// field of slow travelling waves cannot crease below its own wavelength, so
// the surface is smooth BY CONSTRUCTION — and its gradient is analytic, which
// gives exact per-pixel normals with zero mesh faceting.
const VERTEX = `
uniform float uTime;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

// Gerstner-style travelling wave: vertices ORBIT as the wave passes, so each
// crest gathers cloth and rolls forward — the curling, tumbling motion of
// loose gauze, not the up-down bob of a water surface. q is crest steepness;
// the sum of q*k*amp across waves must stay below ~1 or crests self-intersect.
void wave(vec2 p, vec2 dir, float k, float amp, float q, float speed,
          float phase, inout vec3 dp, inout vec3 n) {
  float a = dot(p, dir) * k + uTime * speed + phase;
  float s = sin(a);
  float c = cos(a);
  dp.xy += dir * (q * amp * c);
  dp.z  += amp * s;
  n.xy  -= dir * (k * amp * c);
  n.z   -= q * k * amp * s;
}

void main() {
  vUv = uv;
  vec2 p = position.xy;

  vec3 dp = vec3(0.0);
  vec3 nrm = vec3(0.0, 0.0, 1.0);

  // Gathered dome rest shape — the same soft blob silhouette the old sim
  // rested toward (half extents of the gathered sheet: 1.48 × 1.11).
  float nx = p.x / 1.48;
  float ny = p.y / 1.11;
  float rr = min(nx * nx + ny * ny, 1.0);
  float omr = 1.0 - rr;
  dp.z += 0.5 * omr * omr;
  nrm.xy += omr * vec2(2.0 * nx / 1.48, 2.0 * ny / 1.11);

  // Layered rolling waves with long diagonal crests. The rim waves more than
  // the centre (loose edges), like the curl of a free hem.
  float rim = 0.6 + 0.55 * rr;
  wave(p, normalize(vec2( 0.80,  0.60)), 1.6, 0.27 * rim, 0.45,  0.65, 0.0, dp, nrm);
  wave(p, normalize(vec2(-0.50,  0.85)), 2.3, 0.18 * rim, 0.45, -0.50, 1.7, dp, nrm);
  wave(p, normalize(vec2( 0.95, -0.30)), 3.1, 0.11 * rim, 0.45,  0.85, 4.2, dp, nrm);
  wave(p, normalize(vec2(-0.85, -0.55)), 1.1, 0.22 * rim, 0.45,  0.40, 2.6, dp, nrm);
  wave(p, normalize(vec2( 0.20,  0.98)), 4.1, 0.06 * rim, 0.40, -1.00, 5.1, dp, nrm);
  // one long slow swell so the whole mass breathes
  wave(p, normalize(vec2( 0.60, -0.80)), 0.55, 0.20, 0.30, 0.20, 3.3, dp, nrm);

  // Fine flutter — short wavelengths (still ~15+ grid cells, far above any
  // aliasing), small amplitude, FAST: the quick shiver of a thin hem in air.
  wave(p, normalize(vec2( 0.30,  0.95)),  6.5, 0.035 * rim, 0.0,  1.30, 0.9, dp, nrm);
  wave(p, normalize(vec2(-0.90,  0.40)),  9.0, 0.022 * rim, 0.0, -1.05, 2.2, dp, nrm);
  wave(p, normalize(vec2( 0.75, -0.66)), 12.5, 0.013 * rim, 0.0,  1.60, 5.8, dp, nrm);

  vec3 pos3 = vec3(p + dp.xy, dp.z);
  vec3 n = normalize(nrm);

  vNormal = normalize(normalMatrix * n);
  vec4 wp = modelMatrix * vec4(pos3, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = `
precision highp float;

uniform float uTime;
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
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);

  // Thin gauze is lit the same whichever face you see, so every lighting term
  // uses an even (abs) function of N — the field stays continuous across any
  // fold-over silhouette.
  float NdotL = abs(dot(N, L));
  float NdotV = abs(dot(N, V));
  float NdotH = abs(dot(N, H));

  // Two-sided diffuse: bright facing the light from either side, deep red
  // where the cloth turns edge-on to it. The power adds mid-tone contrast so
  // creases shade crisply; floored so they never hit black.
  float wrap    = 0.14 + 0.86 * pow(NdotL, 1.5);
  float fresnel = pow(1.0 - NdotV, 2.2);             // rim / edge glow

  // Specular anti-aliasing: widen the highlight lobe where the normal varies
  // fast across a pixel and dim it to conserve energy — glints melt instead
  // of crawling as the cloth moves.
  vec3 nDx = dFdx(N);
  vec3 nDy = dFdy(N);
  float sigma2 = min(dot(nDx, nDx) + dot(nDy, nDy), 0.6);
  float shin = uShininess / (1.0 + uShininess * sigma2);
  float spec = pow(NdotH, shin) * (shin + 2.0) / (uShininess + 2.0);

  float trans   = pow(clamp(dot(V, -L), 0.0, 1.0), 2.0) * (1.0 - NdotV);

  // Dissolve the four borders so the veil has no hard rectangle edge — but
  // make the hem UNDULATE like loose fabric instead of fading in a straight
  // vignette band. A narrow fade + wavy border reads as a gauze hem.
  float wx = 0.045 * sin(vUv.y * 7.0 + uTime * 0.26)
           + 0.028 * sin(vUv.y * 15.0 - uTime * 0.19);
  float wy = 0.045 * sin(vUv.x * 8.0 - uTime * 0.23)
           + 0.028 * sin(vUv.x * 13.0 + uTime * 0.17);
  float ux = vUv.x + wx;
  float uy = vUv.y + wy;
  float edge =
    smoothstep(0.0, 0.14, ux) * smoothstep(1.0, 0.86, ux) *
    smoothstep(0.0, 0.14, uy) * smoothstep(1.0, 0.86, uy);
  edge = smoothstep(0.0, 1.0, edge); // ease the curve so the fade has no kink

  // Additive glow (rim, satin, backlight) is gated by the edge fade so the
  // free boundary can't blow out into bright spikes.
  vec3 col = mix(uColorDeep, uColorLit, wrap);
  col += uSheen * fresnel * 0.45 * edge;  // luminous edges
  col += uSpec * spec * 0.6 * edge;       // satin glint
  col += uColorLit * trans * 0.22 * edge; // faint backlight

  float alpha = clamp(uBaseAlpha + spec * 0.15 * edge, 0.0, 0.99);
  alpha *= edge;

  gl_FragColor = vec4(col, alpha);
}
`;

const SETTINGS = {
  desktop: { cols: 126, rows: 84 },
  mobile: { cols: 46, rows: 32 },
};

// Reveal — the silk enters as a tall, narrow vertical ribbon of red down the
// centre, then unfurls sideways into the full waving mass.
const REVEAL = {
  duration: 3.2, // seconds
  start: { x: 0.1, y: 1.18, z: 0.1 },
};
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export function initVeil(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch (e) {
    canvas.style.background = "radial-gradient(120% 90% at 40% 30%, #7d0a18, #2a0309 60%, #160206)";
    return () => {};
  }

  renderer.setClearColor(0x000000, 0);
  // Fixed 1920×1080 showcase page: always supersample at 2× (even on DPR-1
  // monitors) so silhouettes get smoothed by the downscale on top of MSAA.
  renderer.setPixelRatio(2);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);

  const isMobile = Math.min(window.innerWidth, window.innerHeight) < 640;
  const { cols, rows } = isMobile ? SETTINGS.mobile : SETTINGS.desktop;

  // Sheet sized to a contained mass that floats in the middle of the view.
  // The grid is flat; all motion happens in the vertex shader. The rim is
  // gathered inward so the rectangle rounds into a blob.
  const sheetW = 3.6;
  const sheetH = 2.7;
  const gather = 0.18;
  const hw = sheetW / 2;
  const hh = sheetH / 2;

  const count = cols * rows;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i;
      const fx = (i / (cols - 1) - 0.5) * sheetW;
      const fy = (0.5 - j / (rows - 1)) * sheetH;
      const nx = fx / hw;
      const ny = fy / hh;
      const rr = Math.min(1, nx * nx + ny * ny);
      positions[n * 3] = fx * (1 - gather * rr);
      positions[n * 3 + 1] = fy * (1 - gather * rr);
      positions[n * 3 + 2] = 0;
      uvs[n * 2] = i / (cols - 1);
      uvs[n * 2 + 1] = 1 - j / (rows - 1);
    }
  }
  const indices = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if ((i + j) % 2 === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, c, d, a, d, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uLightDir: { value: new THREE.Vector3(-0.5, 0.8, 0.7).normalize() },
      uColorDeep: { value: new THREE.Color(0x4a0612) },
      uColorLit: { value: new THREE.Color(0xe0202e) },
      uSheen: { value: new THREE.Color(0xe9a24a).multiplyScalar(0.5) },
      uSpec: { value: new THREE.Color(0xffd9a0).multiplyScalar(0.45) },
      uBaseAlpha: { value: 0.3 },
      uShininess: { value: 42.0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  window.addEventListener("resize", resize);
  resize();

  const baseAlpha = material.uniforms.uBaseAlpha.value;
  let raf = 0;
  let elapsed = 0;

  if (reduceMotion) {
    // A still frame mid-flow, fully revealed.
    mesh.scale.set(1, 1, 1);
    material.uniforms.uTime.value = 8.0;
  } else {
    mesh.scale.set(REVEAL.start.x, REVEAL.start.y, REVEAL.start.z);
    material.uniforms.uBaseAlpha.value = 0;
  }

  function frame() {
    if (!reduceMotion) {
      elapsed += 1 / 60;
      const t = Math.min(1, elapsed / REVEAL.duration);
      const e = easeOutCubic(t);
      mesh.scale.set(REVEAL.start.x + (1 - REVEAL.start.x) * e, REVEAL.start.y + (1 - REVEAL.start.y) * e, REVEAL.start.z + (1 - REVEAL.start.z) * e);
      material.uniforms.uBaseAlpha.value = baseAlpha * e;
      material.uniforms.uTime.value = elapsed;

      // The whole mass drifts and leans a little, so it floats rather than
      // sitting bolted to the centre of the frame.
      mesh.position.set(Math.sin(elapsed * 0.06) * 0.3, Math.cos(elapsed * 0.045) * 0.18, 0);
      mesh.rotation.z = 0.05 * Math.sin(elapsed * 0.03 + 1.0);
    }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}
