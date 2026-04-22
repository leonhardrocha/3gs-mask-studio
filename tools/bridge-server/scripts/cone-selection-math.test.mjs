import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors the cone predicate used by select.byCone:
 *   t = dot(v, axis)
 *   0 < t <= range
 *   radialSq <= (t * tanHalfAngle)^2
 */
function pointInsideCone(point, apex, axis, range, tanHalfAngle) {
    const vx = point.x - apex.x;
    const vy = point.y - apex.y;
    const vz = point.z - apex.z;

    const t = vx * axis.x + vy * axis.y + vz * axis.z;
    if (t <= 0 || t > range) {
        return false;
    }

    const rx = vx - t * axis.x;
    const ry = vy - t * axis.y;
    const rz = vz - t * axis.z;
    const radialSq = rx * rx + ry * ry + rz * rz;
    const limit = t * tanHalfAngle;

    return radialSq <= limit * limit;
}

describe('cone selection math', () => {
    const apex = { x: 0, y: 0, z: 0 };
    const axis = { x: 0, y: 0, z: 1 };
    const range = 5;
    const tanHalf = Math.tan((30 * Math.PI / 180) * 0.5);

    it('accepts points strictly in front and inside radius', () => {
        const inside = pointInsideCone({ x: 0.2, y: 0.1, z: 2 }, apex, axis, range, tanHalf);
        assert.equal(inside, true);
    });

    it('rejects points behind apex', () => {
        const behind = pointInsideCone({ x: 0, y: 0, z: -0.5 }, apex, axis, range, tanHalf);
        assert.equal(behind, false);
    });

    it('rejects points beyond cone range', () => {
        const tooFar = pointInsideCone({ x: 0, y: 0, z: 6 }, apex, axis, range, tanHalf);
        assert.equal(tooFar, false);
    });

    it('rejects points outside cone radius at depth', () => {
        const z = 2;
        const radiusAtZ = z * tanHalf;
        const outside = pointInsideCone({ x: radiusAtZ + 0.001, y: 0, z }, apex, axis, range, tanHalf);
        assert.equal(outside, false);
    });

    it('accepts points on boundary radius', () => {
        const z = 2;
        const radiusAtZ = z * tanHalf;
        const onBoundary = pointInsideCone({ x: radiusAtZ, y: 0, z }, apex, axis, range, tanHalf);
        assert.equal(onBoundary, true);
    });
});

describe('selection accumulation', () => {
    it('deduplicates indices across multiple passes', () => {
        const passA = [2, 4, 6, 8];
        const passB = [4, 5, 6, 9];

        const accumulated = [...new Set([...passA, ...passB])].sort((a, b) => a - b);
        assert.deepEqual(accumulated, [2, 4, 5, 6, 8, 9]);
    });
});
