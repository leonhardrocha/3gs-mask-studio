import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    applyDeadZone,
    clampVirtualCursor,
    resolveOperation
} from './input-pointer-utils.mjs';

describe('input-pointer utils', () => {
    it('applies deadzone correctly', () => {
        assert.equal(applyDeadZone(0.1, 0.2), 0);
        assert.equal(applyDeadZone(-0.15, 0.2), 0);
        assert.equal(applyDeadZone(0.25, 0.2), 0.25);
        assert.equal(applyDeadZone(-0.5, 0.2), -0.5);
    });

    it('clamps virtual cursor into viewport bounds', () => {
        assert.deepEqual(clampVirtualCursor(-10, -5, 100, 80), { x: 0, y: 0 });
        assert.deepEqual(clampVirtualCursor(999, 500, 100, 80), { x: 99, y: 79 });
        assert.deepEqual(clampVirtualCursor(10, 20, 100, 80), { x: 10, y: 20 });
    });

    it('resolves operation priority as remove > add > set', () => {
        assert.equal(resolveOperation(false, false), 'set');
        assert.equal(resolveOperation(true, false), 'add');
        assert.equal(resolveOperation(false, true), 'remove');
        assert.equal(resolveOperation(true, true), 'remove');
    });
});
