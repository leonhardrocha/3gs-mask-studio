// Node smoke test for the pure grid core in src/selection/splat-index.mjs.
// Run: node scripts/test-splat-index.mjs
import { buildGrid, raycastGrid } from '../src/selection/splat-index.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } };
const near = (a, b, eps = 0.2) => Math.abs(a - b) <= eps;

// Build a dense grid of points on the plane z = 5, spanning x,y in [-2,2].
const makePlane = (z, step = 0.05, span = 2) => {
    const pts = [];
    for (let x = -span; x <= span; x += step) for (let y = -span; y <= span; y += step) pts.push(x, y, z);
    return Float32Array.from(pts);
};

{
    const pos = makePlane(5);
    const grid = buildGrid(pos, pos.length / 3);
    const t = raycastGrid(grid, [0, 0, 0], [0, 0, 1], 0.1, 100);
    ok(near(t, 5), `straight hit on plane z=5, got t=${t.toFixed(3)}`);

    const miss = raycastGrid(grid, [0, 0, 0], [0, 0, -1], 0.1, 100);
    ok(miss === -1, `ray pointing away misses, got t=${miss}`);

    const offMiss = raycastGrid(grid, [10, 10, 0], [0, 0, 1], 0.1, 100);
    ok(offMiss === -1, `ray outside plane extent misses, got t=${offMiss}`);
}

{
    // Front-most: two planes; ray should hit the nearer one (z=5).
    const a = makePlane(5), b = makePlane(10);
    const pos = new Float32Array(a.length + b.length);
    pos.set(a, 0); pos.set(b, a.length);
    const grid = buildGrid(pos, pos.length / 3);
    const t = raycastGrid(grid, [0, 0, 0], [0, 0, 1], 0.1, 100);
    ok(near(t, 5), `front-most hit (planes 5 & 10), got t=${t.toFixed(3)}`);
}

{
    // Beam radius: a plane (z=5) with a circular hole of radius 0.1 in the middle.
    // A centred ray hits the hole's rim only when the beam reaches it.
    const pts = [];
    for (let x = -1; x <= 1; x += 0.02) for (let y = -1; y <= 1; y += 0.02) {
        if (Math.hypot(x, y) >= 0.1) pts.push(x, y, 5);
    }
    const pos = Float32Array.from(pts);
    // Product path: grid cell size ≈ snap beam radius.
    const hit = raycastGrid(buildGrid(pos, pos.length / 3, { cellSize: 0.05 }), [0, 0, 0], [0, 0, 1], 0.13, 100);
    ok(near(hit, 5, 0.05), `beam reaches hole rim → hit, got t=${hit.toFixed(3)}`);
    const miss = raycastGrid(buildGrid(pos, pos.length / 3, { cellSize: 0.05 }), [0, 0, 0], [0, 0, 1], 0.05, 100);
    ok(miss === -1, `beam smaller than hole → miss, got t=${miss}`);
}

{
    // Jitter: sweep the ray laterally across a dense plane; depth t should stay
    // stable (≈ plane depth), i.e. no "splats pulling" laterally.
    const pos = makePlane(5, 0.04);
    const grid = buildGrid(pos, pos.length / 3);
    let min = Infinity, max = -Infinity, hits = 0, n = 0;
    for (let a = -0.3; a <= 0.3; a += 0.01) {
        n++;
        // ray from origin toward (a, 0, 5), normalized inside raycast
        const t = raycastGrid(grid, [0, 0, 0], [a, 0, 5], 0.06, 100);
        if (t > 0) {
            hits++;
            // depth along Z = t * dz; compare the z-coordinate of the hit point
            const dz = 5 / Math.hypot(a, 0, 5);
            const z = t * dz;
            if (z < min) min = z; if (z > max) max = z;
        }
    }
    ok(hits / n > 0.95, `sweep hit rate ${(hits / n * 100).toFixed(0)}% (dropouts low)`);
    ok((max - min) < 0.15, `sweep depth jitter ${(max - min).toFixed(3)} small (z in [${min.toFixed(2)},${max.toFixed(2)}])`);
}

console.log(`\n${fail === 0 ? 'OK' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
