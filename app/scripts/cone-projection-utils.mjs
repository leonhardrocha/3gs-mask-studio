function normalize3(v) {
    const x = Number(v?.x ?? 0);
    const y = Number(v?.y ?? 0);
    const z = Number(v?.z ?? 0);
    const len = Math.hypot(x, y, z);
    if (!Number.isFinite(len) || len <= 1e-12) {
        return { x: 0, y: 0, z: -1 };
    }
    return { x: x / len, y: y / len, z: z / len };
}

function rayDirectionFromNearFar(near, far) {
    return normalize3({
        x: Number(far?.x ?? 0) - Number(near?.x ?? 0),
        y: Number(far?.y ?? 0) - Number(near?.y ?? 0),
        z: Number(far?.z ?? 0) - Number(near?.z ?? 0)
    });
}

function rotateVectorByQuaternion(v, q) {
    const vx = Number(v?.x ?? 0);
    const vy = Number(v?.y ?? 0);
    const vz = Number(v?.z ?? 0);
    const qx = Number(q?.x ?? 0);
    const qy = Number(q?.y ?? 0);
    const qz = Number(q?.z ?? 0);
    const qw = Number(q?.w ?? 1);

    const ix = qw * vx + qy * vz - qz * vy;
    const iy = qw * vy + qz * vx - qx * vz;
    const iz = qw * vz + qx * vy - qy * vx;
    const iw = -qx * vx - qy * vy - qz * vz;

    return {
        x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
        y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
        z: iz * qw + iw * -qz + ix * -qy - iy * -qx
    };
}

function forwardFromQuaternion(q) {
    return normalize3(rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, q));
}

export {
    forwardFromQuaternion,
    rayDirectionFromNearFar
};
