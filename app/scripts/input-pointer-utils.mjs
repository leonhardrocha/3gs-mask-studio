function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function applyDeadZone(value, deadZone = 0.2) {
    const v = Number(value);
    const dz = clamp01(deadZone);
    if (!Number.isFinite(v)) return 0;
    return Math.abs(v) >= dz ? v : 0;
}

function clampVirtualCursor(x, y, width, height) {
    const w = Number.isFinite(width) && width > 0 ? width : 1;
    const h = Number.isFinite(height) && height > 0 ? height : 1;

    const nx = Number.isFinite(x) ? x : w * 0.5;
    const ny = Number.isFinite(y) ? y : h * 0.5;

    return {
        x: Math.min(Math.max(nx, 0), w - 1),
        y: Math.min(Math.max(ny, 0), h - 1)
    };
}

function resolveOperation(addPressed, removePressed) {
    if (removePressed) return 'remove';
    if (addPressed) return 'add';
    return 'set';
}

export {
    applyDeadZone,
    clampVirtualCursor,
    resolveOperation
};
