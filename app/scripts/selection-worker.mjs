// selection-worker.mjs
// Worker para selecionar indices de splats por cone em background.

/** @type {Float32Array | null} */
let worldPositions = null;

function pointInsideCone(px, py, pz, apex, axis, tanAngle, maxRange) {
    const dx = px - apex.x;
    const dy = py - apex.y;
    const dz = pz - apex.z;

    const t = dx * axis.x + dy * axis.y + dz * axis.z;
    if (t < 0 || t > maxRange) return false;

    const rx = dx - t * axis.x;
    const ry = dy - t * axis.y;
    const rz = dz - t * axis.z;
    const r2 = rx * rx + ry * ry + rz * rz;
    const limit = t * tanAngle;

    return r2 <= limit * limit;
}

self.onmessage = (ev) => {
    const msg = ev.data;

    if (msg.type === 'setPositions') {
        worldPositions = new Float32Array(msg.positions);
        self.postMessage({ type: 'positions:ready', count: worldPositions.length / 3 });
        return;
    }

    if (msg.type === 'selectChunk') {
        if (!worldPositions) {
            self.postMessage({ type: 'selected', requestId: msg.requestId, indices: new Uint32Array(0) });
            return;
        }

        const { start, end, apex, axis, tanAngle, maxRange, requestId } = msg;
        const out = [];

        for (let i = start; i < end; i++) {
            const base = i * 3;
            const px = worldPositions[base];
            const py = worldPositions[base + 1];
            const pz = worldPositions[base + 2];

            if (pointInsideCone(px, py, pz, apex, axis, tanAngle, maxRange)) {
                out.push(i);
            }
        }

        const indices = new Uint32Array(out);
        self.postMessage({ type: 'selected', requestId, indices }, [indices.buffer]);
    }
};
