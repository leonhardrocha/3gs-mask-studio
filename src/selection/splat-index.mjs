/**
 * CPU spatial index for surface snapping (Fase 1.5 spike).
 *
 * Builds a uniform hash grid over splat WORLD centers (with committed edits
 * applied) and answers ray queries by marching the ray and returning the
 * front-most splat whose center lies within `beamRadius` of the ray. The query
 * returns the ray parameter `t` (depth along the ray) — the brush stays ON the
 * ray (lateral 1:1), only the depth comes from the surface.
 *
 * Why a CPU index instead of `pc.Picker` in XR: no GPU readback (no per-frame
 * hitch / latency), works under WebGL and WebGPU, and scopes naturally per
 * object. Trade-off: it snaps to splat *centers* (a soft cloud has no hard
 * surface), so the result is smoothed in depth by the caller.
 *
 * The grid math is intentionally dependency-free (plain Float32Array + numbers)
 * so it can be unit-tested in Node without the engine. The higher-level
 * `createSplatIndex` extracts world centers from the selection system using
 * plain matrix/quaternion math (no `pc` import).
 *
 * NOTE (spike): the marcher uses string cell keys and a 3×3×3 neighbourhood —
 * correct and simple, not optimized. Production would use 3D-DDA traversal with
 * typed-array buckets. The spike's job is to measure jitter/feel, not throughput.
 */

// --- Pure grid core (no engine deps) ---------------------------------------

/**
 * Build a uniform hash grid over `count` points stored xyz-interleaved in
 * `positions`. Returns a grid object consumed by {@link raycastGrid}.
 */
export function buildGrid(positions, count, { targetPerCell = 8, cellSize: forcedCell = 0 } = {}) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const dx = Math.max(maxX - minX, 1e-6);
    const dy = Math.max(maxY - minY, 1e-6);
    const dz = Math.max(maxZ - minZ, 1e-6);

    // Cell size: ideally tied to the snap beam radius (caller passes `cellSize`),
    // which keeps the query neighbourhood at nr≈1. When not forced, fall back to a
    // density estimate floored relative to scene extent so it never collapses on
    // flat/planar distributions. Sparse cells cost nothing (Map-backed).
    const extentMax = Math.max(dx, dy, dz);
    const spacing = Math.cbrt((dx * dy * dz) / Math.max(1, count));
    const cellSize = forcedCell > 0 ?
        forcedCell :
        Math.max(spacing * Math.cbrt(targetPerCell), extentMax / 256, 1e-3);

    // Collision-free numeric cell key (ix*ny + iy)*nz + iz over bounded grid dims
    // — far cheaper than string keys. Cells outside [0,n*) are rejected at query.
    const nx = Math.floor(dx / cellSize) + 1;
    const ny = Math.floor(dy / cellSize) + 1;
    const nz = Math.floor(dz / cellSize) + 1;
    const clampIdx = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);

    const cells = new Map(); // numeric key -> number[] of point indices
    for (let i = 0; i < count; i++) {
        const ix = clampIdx(Math.floor((positions[i * 3] - minX) / cellSize), nx);
        const iy = clampIdx(Math.floor((positions[i * 3 + 1] - minY) / cellSize), ny);
        const iz = clampIdx(Math.floor((positions[i * 3 + 2] - minZ) / cellSize), nz);
        const k = (ix * ny + iy) * nz + iz;
        let bucket = cells.get(k);
        if (!bucket) { bucket = []; cells.set(k, bucket); }
        bucket.push(i);
    }

    return { positions, count, min: [minX, minY, minZ], max: [maxX, maxY, maxZ], cellSize, nx, ny, nz, cells };
}

/** Clip a ray to an AABB; returns [tEnter, tExit] or null if it misses. */
function clipRayAabb(ox, oy, oz, dx, dy, dz, min, max) {
    let t0 = 0, t1 = Infinity;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) {
            if (o[a] < min[a] || o[a] > max[a]) return null;
        } else {
            const inv = 1 / d[a];
            let tn = (min[a] - o[a]) * inv;
            let tf = (max[a] - o[a]) * inv;
            if (tn > tf) { const tmp = tn; tn = tf; tf = tmp; }
            if (tn > t0) t0 = tn;
            if (tf < t1) t1 = tf;
            if (t0 > t1) return null;
        }
    }
    return [t0, t1];
}

/**
 * March `ray` through the grid and return the depth `t` of the front-most splat
 * within `beamRadius` of the ray, or -1 on a miss. `origin`/`dir` are length-3
 * arrays; `dir` need not be normalized.
 */
export function raycastGrid(grid, origin, dir, beamRadius, maxDist = Infinity) {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const dx = dir[0] / len, dy = dir[1] / len, dz = dir[2] / len;
    const ox = origin[0], oy = origin[1], oz = origin[2];

    const { min, cellSize, cells, positions, nx, ny, nz } = grid;
    // Expand the AABB by beamRadius so splats near the boundary aren't missed.
    const emin = [min[0] - beamRadius, min[1] - beamRadius, min[2] - beamRadius];
    const emax = [grid.max[0] + beamRadius, grid.max[1] + beamRadius, grid.max[2] + beamRadius];
    const clip = clipRayAabb(ox, oy, oz, dx, dy, dz, emin, emax);
    if (!clip) return -1;

    const t0 = Math.max(0, clip[0]);
    const t1 = Math.min(maxDist, clip[1]);
    if (t0 > t1) return -1;

    // Neighbourhood radius in cells, capped: a beam much larger than the cell
    // can't explode the query. Splats farther than NR_MAX cells laterally are
    // ignored — acceptable for snapping (we want the nearest surface on the ray).
    const NR_MAX = 8;
    const nr = Math.min(NR_MAX, Math.max(1, Math.ceil(beamRadius / cellSize)));
    const beam2 = beamRadius * beamRadius;
    const step = cellSize;

    let best = -1;
    for (let t = t0; t <= t1 + step; t += step) {
        const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
        const cx = Math.floor((px - min[0]) / cellSize);
        const cy = Math.floor((py - min[1]) / cellSize);
        const cz = Math.floor((pz - min[2]) / cellSize);

        for (let a = -nr; a <= nr; a++) {
            const gx = cx + a;
            if (gx < 0 || gx >= nx) continue;
            for (let b = -nr; b <= nr; b++) {
                const gy = cy + b;
                if (gy < 0 || gy >= ny) continue;
                for (let c = -nr; c <= nr; c++) {
                    const gz = cz + c;
                    if (gz < 0 || gz >= nz) continue;
                    const bucket = cells.get((gx * ny + gy) * nz + gz);
                    if (!bucket) continue;
                    for (let j = 0; j < bucket.length; j++) {
                        const i = bucket[j];
                        const sx = positions[i * 3] - ox;
                        const sy = positions[i * 3 + 1] - oy;
                        const sz = positions[i * 3 + 2] - oz;
                        // Projection of the splat onto the ray.
                        const tp = sx * dx + sy * dy + sz * dz;
                        if (tp < t0 || tp > t1) continue;
                        // Perpendicular distance² from splat to the ray.
                        const ex = sx - dx * tp, ey = sy - dy * tp, ez = sz - dz * tp;
                        const perp2 = ex * ex + ey * ey + ez * ez;
                        if (perp2 <= beam2 && (best < 0 || tp < best)) best = tp;
                    }
                }
            }
        }
        // Front-most hit found: one extra step catches a closer splat just entered.
        if (best >= 0 && t > best + step) break;
    }
    return best;
}

// --- Engine-facing builder (no `pc` import; plain math) ---------------------

const rotateByQuat = (qx, qy, qz, qw, vx, vy, vz, out) => {
    // v + 2*cross(q.xyz, cross(q.xyz, v) + q.w*v)
    const tx = qy * vz - qz * vy + qw * vx;
    const ty = qz * vx - qx * vz + qw * vy;
    const tz = qx * vy - qy * vx + qw * vz;
    out[0] = vx + 2 * (qy * tz - qz * ty);
    out[1] = vy + 2 * (qz * tx - qx * tz);
    out[2] = vz + 2 * (qx * ty - qy * tx);
};

/**
 * Creates a snap index over the selection system's splats. Reflects committed
 * edits (rebuild after a commit). Scopes to `activeSelectionTarget` when set.
 */
export function createSplatIndex({ system, data }) {
    let grid = null;
    let dirty = true;
    const tmp = [0, 0, 0];

    // Snap beam radius (m): the lateral tolerance of the ray and the grid cell
    // size, kept equal so the query neighbourhood stays at nr≈1. A precision knob
    // independent of the (larger) brush size.
    const beam = () => data.get('snapBeamRadius') ?? 0.05;

    const scoped = () => {
        const target = data.get('activeSelectionTarget') ?? 'all';
        return system.selectables.filter(s => s.entity.enabled && (target === 'all' || s.entity.name === target));
    };

    // Extract edited world centers for the scoped objects into one flat array.
    const extract = (objs) => {
        let total = 0;
        const parts = [];
        for (const s of objs) {
            const centers = s.resource?.gsplatData?.getCenters?.();
            if (!centers) continue; // some compressed formats lack CPU centers
            const n = (centers.length / 3) | 0;
            const wm = s.entity.getWorldTransform().data; // column-major mat4
            const m = s._mirror; // committed similarity transform, or undefined
            const out = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                const lx = centers[i * 3], ly = centers[i * 3 + 1], lz = centers[i * 3 + 2];
                // world = M * local
                let wx = wm[0] * lx + wm[4] * ly + wm[8] * lz + wm[12];
                let wy = wm[1] * lx + wm[5] * ly + wm[9] * lz + wm[13];
                let wz = wm[2] * lx + wm[6] * ly + wm[10] * lz + wm[14];
                if (m) {
                    const k = i * 4;
                    rotateByQuat(m.quat[k], m.quat[k + 1], m.quat[k + 2], m.quat[k + 3], wx, wy, wz, tmp);
                    const sc = m.ts[k + 3];
                    wx = m.ts[k] + sc * tmp[0];
                    wy = m.ts[k + 1] + sc * tmp[1];
                    wz = m.ts[k + 2] + sc * tmp[2];
                }
                out[i * 3] = wx; out[i * 3 + 1] = wy; out[i * 3 + 2] = wz;
            }
            parts.push(out);
            total += n;
        }
        if (total === 0) return { positions: new Float32Array(0), count: 0 };
        if (parts.length === 1) return { positions: parts[0], count: total };
        const positions = new Float32Array(total * 3);
        let off = 0;
        for (const p of parts) { positions.set(p, off); off += p.length; }
        return { positions, count: total };
    };

    const rebuild = () => {
        const t0 = performance.now();
        const { positions, count } = extract(scoped());
        grid = count > 0 ? buildGrid(positions, count, { cellSize: beam() }) : null;
        dirty = false;
        return { count, ms: performance.now() - t0 };
    };

    const markDirty = () => { dirty = true; };

    // Returns ray depth t (>0) or -1. Lazily rebuilds when dirty.
    const raycast = (originVec, dirVec, maxDist) => {
        if (dirty) rebuild();
        if (!grid) return -1;
        return raycastGrid(
            grid,
            [originVec.x, originVec.y, originVec.z],
            [dirVec.x, dirVec.y, dirVec.z],
            beam(), maxDist
        );
    };

    // Rebuild whenever committed geometry, scope, or the beam scale changes.
    data.on('commitEdit', markDirty);
    data.on('activeSelectionTarget:set', markDirty);
    data.on('snapBeamRadius:set', markDirty);

    return { rebuild, markDirty, raycast, get ready() { return !dirty && !!grid; }, get count() { return grid?.count ?? 0; } };
}
