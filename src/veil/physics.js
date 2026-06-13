// Verlet cloth — a grid of particles held together by distance constraints.
// No pins: the veil floats freely. A weak pull toward a slowly-drifting home
// keeps it loosely in frame; a flowing wind field does the billowing.

// Smooth, organic flow noise built from layered trig — cheap and bug-proof,
// plenty for driving wind on a background veil.
function flow(x, y, z) {
  return (
    Math.sin(x * 1.0 + Math.cos(y * 0.7 + z)) * 0.5 +
    Math.sin(y * 1.3 + z * 0.9) * 0.3 +
    Math.sin((x + y) * 0.6 + z * 1.7) * 0.2
  );
}

export class ClothSim {
  constructor({ cols, rows, width, height, bulge = 1.0, gather = 0.18 }) {
    this.cols = cols;
    this.rows = rows;
    this.count = cols * rows;
    this.width = width;
    this.height = height;

    this.pos = new Float32Array(this.count * 3);
    this.prev = new Float32Array(this.count * 3);
    this.home = new Float32Array(this.count * 3);

    const hw = width / 2;
    const hh = height / 2;

    let k = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const fx = (i / (cols - 1) - 0.5) * width;
        const fy = (0.5 - j / (rows - 1)) * height;

        // Radial falloff from the sheet centre (0 at middle → ~1 at the rim).
        const nx = fx / hw;
        const ny = fy / hh;
        const rr = Math.min(1, nx * nx + ny * ny);

        // Gather the rim inward so the rectangle rounds into a blob, and dome
        // the centre toward the viewer — together this reads as a gathered
        // clump of silk rather than a flat hanging sheet.
        const x = fx * (1 - gather * rr);
        const y = fy * (1 - gather * rr);
        const dome = bulge * (1 - rr) * (1 - rr);

        // A faint, LOW-frequency initial fold riding on top of the dome so the
        // mass keeps soft creases as it billows.
        const z =
          dome +
          Math.sin(x * 1.2 + y * 0.6) * 0.12 +
          Math.cos(y * 1.0 - x * 0.4) * 0.1;
        this.pos[k] = x;
        this.pos[k + 1] = y;
        this.pos[k + 2] = z;
        this.prev[k] = x;
        this.prev[k + 1] = y;
        this.prev[k + 2] = z;
        this.home[k] = x;
        this.home[k + 1] = y;
        this.home[k + 2] = dome; // rest toward the domed shape, not a flat plane
        k += 3;
      }
    }

    this._buildConstraints();
    this.t = 0;
  }

  _idx(i, j) {
    return j * this.cols + i;
  }

  _buildConstraints() {
    const A = [];
    const B = [];
    const rest = [];
    const add = (a, b) => {
      const ax = this.pos[a * 3];
      const ay = this.pos[a * 3 + 1];
      const az = this.pos[a * 3 + 2];
      const bx = this.pos[b * 3];
      const by = this.pos[b * 3 + 1];
      const bz = this.pos[b * 3 + 2];
      A.push(a);
      B.push(b);
      rest.push(Math.hypot(ax - bx, ay - by, az - bz));
    };

    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const a = this._idx(i, j);
        if (i < this.cols - 1) add(a, this._idx(i + 1, j)); // structural →
        if (j < this.rows - 1) add(a, this._idx(i, j + 1)); // structural ↓
        if (i < this.cols - 1 && j < this.rows - 1)
          add(a, this._idx(i + 1, j + 1)); // shear ↘
        if (i > 0 && j < this.rows - 1) add(a, this._idx(i - 1, j + 1)); // shear ↙
        if (i < this.cols - 2) add(a, this._idx(i + 2, j)); // bend →
        if (j < this.rows - 2) add(a, this._idx(i, j + 2)); // bend ↓
      }
    }

    this.cA = Int32Array.from(A);
    this.cB = Int32Array.from(B);
    this.cRest = Float32Array.from(rest);
    this.cCount = rest.length;
  }

  // Push particles near a world-space point — the cursor's wake.
  addImpulse(px, py, radius, strength) {
    const r2 = radius * radius;
    for (let n = 0; n < this.count; n++) {
      const k = n * 3;
      const dx = this.pos[k] - px;
      const dy = this.pos[k + 1] - py;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const fall = (1 - d2 / r2) * strength;
      this.pos[k + 2] += fall; // bulge toward the viewer
      const inv = 1 / (Math.sqrt(d2) + 1e-4);
      this.pos[k] += dx * inv * fall * 0.25;
      this.pos[k + 1] += dy * inv * fall * 0.25;
    }
  }

  update(dt, p) {
    this.t += dt;
    const t = this.t;
    const dt2 = dt * dt;

    const ws = p.windStrength;
    const wspd = p.windSpeed;
    const grav = p.gravity;
    const damp = p.damping;
    const recenterK = p.recenter ?? 1.0;
    const tumbleK = p.tumble ?? 0;
    const floatZ = p.floatZ ?? 0;

    const hw = this.width / 2;
    const hh = this.height / 2;
    const wf = p.wrinkle ?? 0;
    const curlK = p.curl ?? 0;
    const ti = t * wspd;
    const pos = this.pos;

    const softR = this.width * (p.containR ?? 1e9);
    const softZ = p.containZ ?? 1e9;
    const boundK = p.boundary ?? 0;

    // --- centre of mass: where the whole cloth currently floats ---
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let n = 0; n < this.count; n++) {
      cx += pos[n * 3];
      cy += pos[n * 3 + 1];
      cz += pos[n * 3 + 2];
    }
    cx /= this.count;
    cy /= this.count;
    cz /= this.count;

    // A slowly drifting target the whole mass is pulled toward — it roams a
    // little without ever leaving the centre of the frame.
    const targetX = Math.sin(t * 0.06) * p.sway;
    const targetY = Math.cos(t * 0.045) * p.sway * 0.6;

    // ONE restoring force on the entire mass (not per-particle) toward that
    // target. This holds the cloth centred while leaving its shape completely
    // free to fold and tumble — the key to losing the rigid rectangle.
    const rfx = (targetX - cx) * recenterK;
    const rfy = (targetY - cy) * recenterK;
    const rfz = (floatZ - cz) * recenterK;

    for (let n = 0; n < this.count; n++) {
      const k = n * 3;
      const x = pos[k];
      const y = pos[k + 1];
      const z = pos[k + 2];

      // --- forces ---
      let fx = rfx;
      let fy = rfy - grav;
      let fz = rfz;

      // Turbulent, spatially-varying wind → large organic folds + billowing.
      fx += flow(x * 0.45, y * 0.45, ti) * ws;
      fy += flow(x * 0.45 + 5.0, y * 0.45, ti + 2.0) * ws * 0.6;
      fz +=
        (flow(x * 0.5, y * 0.5 + 3.0, ti * 1.2) + 0.3 * Math.sin(ti * 0.7)) *
        ws *
        1.4;

      // Gentle vortex about the centre of mass → the whole sheet slowly tumbles,
      // rolling its folds over the way fabric turns in a draught.
      const dxc = x - cx;
      const dyc = y - cy;
      fx += -dyc * tumbleK;
      fy += dxc * tumbleK;
      fz += (dxc + dyc) * tumbleK * 0.5 * Math.sin(ti * 0.5);

      // Fine creases of thin gauze — kept low-frequency in time so the rim
      // breathes slowly instead of shimmering into a comb of spikes.
      fz +=
        Math.sin(x * 2.4 + y * 1.8 + ti * 1.8) * wf +
        Math.sin(y * 2.8 - x * 1.1 - ti * 1.4) * wf * 0.7;

      // Rim-weighted flap so the original edges flip and curl over, like loose
      // fabric tumbling in air. rim ≈ 0 at the centre, 1 at the border.
      const nx = this.home[k] / hw;
      const ny = this.home[k + 1] / hh;
      const rim = Math.min(1, nx * nx + ny * ny);
      fz += flow(x * 0.9, y * 0.9 + 1.0, ti * 1.7) * curlK * rim;

      // Soft radial boundary — when the mass spreads past the disc it is eased
      // back with a gentle force (NOT a hard snap), so the distance constraints
      // can smooth the correction and the edge never bunches into a crease.
      const rad = Math.sqrt(dxc * dxc + dyc * dyc);
      if (rad > softR) {
        const over = (rad - softR) * boundK;
        fx -= (dxc / rad) * over;
        fy -= (dyc / rad) * over;
      }
      const dz = z - cz;
      if (dz > softZ) fz -= (dz - softZ) * boundK;
      else if (dz < -softZ) fz -= (dz + softZ) * boundK;

      // --- Verlet integration ---
      const vx = (x - this.prev[k]) * damp;
      const vy = (y - this.prev[k + 1]) * damp;
      const vz = (z - this.prev[k + 2]) * damp;

      this.prev[k] = x;
      this.prev[k + 1] = y;
      this.prev[k + 2] = z;

      pos[k] = x + vx + fx * dt2;
      pos[k + 1] = y + vy + fy * dt2;
      pos[k + 2] = z + vz + fz * dt2;
    }

    // --- relax distance constraints ---
    const iters = p.iterations;
    for (let it = 0; it < iters; it++) {
      for (let c = 0; c < this.cCount; c++) {
        const a = this.cA[c] * 3;
        const b = this.cB[c] * 3;
        let dx = pos[b] - pos[a];
        let dy = pos[b + 1] - pos[a + 1];
        let dz = pos[b + 2] - pos[a + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
        const diff = ((dist - this.cRest[c]) / dist) * 0.5 * p.stiffness;
        dx *= diff;
        dy *= diff;
        dz *= diff;
        pos[a] += dx;
        pos[a + 1] += dy;
        pos[a + 2] += dz;
        pos[b] -= dx;
        pos[b + 1] -= dy;
        pos[b + 2] -= dz;
      }
    }

    // --- smooth the free boundary: the outermost grid ring has no outer
    // neighbours holding it, so it puckers into a sawtooth that renders as a
    // comb of flame-like spikes. Relax each border vertex toward the midpoint
    // of its two neighbours ALONG the edge — this irons out the high-frequency
    // pucker without shrinking the cloth or touching the interior folds.
    this._smoothBoundary(p.edgeSmooth ?? 0, p.edgeSmoothPasses ?? 0);

    // --- containment: keep the floating mass inside a disc around its OWN
    // centre of mass — never a box around fixed grid homes, so the silhouette
    // stays organic. It can fold and tumble freely inside, but can't spread out
    // to fill the screen. Re-find the centroid post-constraint, then clamp.
    let mxc = 0;
    let myc = 0;
    let mzc = 0;
    for (let n = 0; n < this.count; n++) {
      mxc += pos[n * 3];
      myc += pos[n * 3 + 1];
      mzc += pos[n * 3 + 2];
    }
    mxc /= this.count;
    myc /= this.count;
    mzc /= this.count;

    // Generous hard backstop at 1.5× the soft radius — the soft force above
    // does the real work, so this only catches a violent wind spike and never
    // sits on the visible edge.
    const maxR = this.width * (p.containR ?? 1e9) * 1.5;
    const maxR2 = maxR * maxR;
    const maxZ = (p.containZ ?? 1e9) * 1.5;
    for (let n = 0; n < this.count; n++) {
      const k = n * 3;
      const dx = pos[k] - mxc;
      const dy = pos[k + 1] - myc;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxR2) {
        const s = maxR / Math.sqrt(d2);
        pos[k] = mxc + dx * s;
        pos[k + 1] = myc + dy * s;
      }
      const dz = pos[k + 2] - mzc;
      if (dz > maxZ) pos[k + 2] = mzc + maxZ;
      else if (dz < -maxZ) pos[k + 2] = mzc - maxZ;
    }
  }

  // Tangential Laplacian smoothing along the four free edges. Each border
  // vertex is eased toward the average of its two neighbours running ALONG the
  // same edge, which removes the high-frequency sawtooth pucker while leaving
  // the cloth's size and interior folds untouched.
  _smoothBoundary(lambda, passes) {
    if (lambda <= 0 || passes <= 0) return;
    const pos = this.pos;
    const cols = this.cols;
    const rows = this.rows;

    const relaxRun = (idxAt, len) => {
      for (let m = 1; m < len - 1; m++) {
        const a = idxAt(m - 1) * 3;
        const b = idxAt(m) * 3;
        const c = idxAt(m + 1) * 3;
        pos[b] += ((pos[a] + pos[c]) * 0.5 - pos[b]) * lambda;
        pos[b + 1] += ((pos[a + 1] + pos[c + 1]) * 0.5 - pos[b + 1]) * lambda;
        pos[b + 2] += ((pos[a + 2] + pos[c + 2]) * 0.5 - pos[b + 2]) * lambda;
      }
    };

    for (let it = 0; it < passes; it++) {
      relaxRun((m) => m, cols); // top row    j = 0
      relaxRun((m) => (rows - 1) * cols + m, cols); // bottom row j = rows-1
      relaxRun((m) => m * cols, rows); // left col   i = 0
      relaxRun((m) => m * cols + (cols - 1), rows); // right col  i = cols-1
    }
  }
}
