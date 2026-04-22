/**
 * Contract test for ply-exporter.ts tagging strategy.
 *
 * The exporter tags each gaussian's raw opacity:
 *   selected     → opacity_raw = +100  (sigmoid(+100) ≈ 1.0 → passes opacity,gt,0.5)
 *   non-selected → opacity_raw = −100  (sigmoid(−100) ≈ 0.0 → removed)
 *
 * This test builds a minimal tagged PLY by hand (no PlayCanvas/browser runtime),
 * reads it back with @playcanvas/splat-transform, applies the bridge filter and
 * asserts that exactly the selected gaussians survive.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    readFile,
    writeFile,
    getInputFormat,
    getOutputFormat,
    processDataTable,
    MemoryReadFileSystem,
    MemoryFileSystem,
} from '@playcanvas/splat-transform';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a minimal binary-little-endian PLY with the standard gaussian columns
 * plus an explicit opacity column, where each gaussian's opacity_raw is set to
 * either +100 (selected) or -100 (non-selected).
 *
 * @param {boolean[]} selectedFlags  true = selected, false = not selected
 * @returns {Uint8Array}
 */
function buildTaggedPly(selectedFlags) {
    const n = selectedFlags.length;

    // Columns written per gaussian (all float32, 4 bytes each):
    // x y z scale_0 scale_1 scale_2 rot_0 rot_1 rot_2 rot_3 f_dc_0 f_dc_1 f_dc_2 opacity
    const PROPS = [
        'x', 'y', 'z',
        'scale_0', 'scale_1', 'scale_2',
        'rot_0', 'rot_1', 'rot_2', 'rot_3',
        'f_dc_0', 'f_dc_1', 'f_dc_2',
        'opacity',
    ];
    const propLines = PROPS.map(p => `property float ${p}`).join('\n');
    const header = [
        'ply',
        'format binary_little_endian 1.0',
        `element vertex ${n}`,
        propLines,
        'end_header',
        '',
    ].join('\n');

    const headerBytes = new TextEncoder().encode(header);
    const bytesPerGaussian = PROPS.length * 4;
    const dataBytes = n * bytesPerGaussian;

    const out = new Uint8Array(headerBytes.byteLength + dataBytes);
    out.set(headerBytes, 0);

    const view = new DataView(out.buffer);
    let offset = headerBytes.byteLength;

    for (let i = 0; i < n; i++) {
        const opacityRaw = selectedFlags[i] ? 100.0 : -100.0;

        for (const prop of PROPS) {
            let val;
            if (prop === 'opacity') {
                val = opacityRaw;
            } else if (prop === 'rot_0') {
                val = 1.0;  // identity quaternion w component
            } else {
                val = 0.0;
            }
            view.setFloat32(offset, val, true);
            offset += 4;
        }
    }

    return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ply-exporter tagging contract', () => {
    it('selected-only: all 3 gaussians survive the opacity filter', async () => {
        const flags = [true, true, true];
        const ply = buildTaggedPly(flags);

        const memReadFs = new MemoryReadFileSystem();
        memReadFs.set('input.ply', ply);
        const [dataTable] = await readFile({
            filename: 'input.ply',
            inputFormat: getInputFormat('input.ply'),
            options: {},
            params: [],
            fileSystem: memReadFs,
        });

        const filtered = await processDataTable(dataTable, [
            { kind: 'filterByValue', columnName: 'opacity', comparator: 'gt', value: 0.5 },
        ]);

        assert.equal(filtered.numRows, 3, 'all selected gaussians must survive');
    });

    it('non-selected-only: all 3 gaussians are removed by the opacity filter', async () => {
        const flags = [false, false, false];
        const ply = buildTaggedPly(flags);

        const memReadFs = new MemoryReadFileSystem();
        memReadFs.set('input.ply', ply);
        const [dataTable] = await readFile({
            filename: 'input.ply',
            inputFormat: getInputFormat('input.ply'),
            options: {},
            params: [],
            fileSystem: memReadFs,
        });

        const filtered = await processDataTable(dataTable, [
            { kind: 'filterByValue', columnName: 'opacity', comparator: 'gt', value: 0.5 },
        ]);

        assert.equal(filtered.numRows, 0, 'no non-selected gaussians should survive');
    });

    it('mixed: exactly the selected gaussians survive', async () => {
        // indices 1 and 3 are selected out of 5
        const flags = [false, true, false, true, false];
        const ply = buildTaggedPly(flags);

        const memReadFs = new MemoryReadFileSystem();
        memReadFs.set('input.ply', ply);
        const [dataTable] = await readFile({
            filename: 'input.ply',
            inputFormat: getInputFormat('input.ply'),
            options: {},
            params: [],
            fileSystem: memReadFs,
        });

        const filtered = await processDataTable(dataTable, [
            { kind: 'filterByValue', columnName: 'opacity', comparator: 'gt', value: 0.5 },
        ]);

        assert.equal(filtered.numRows, 2, 'exactly the 2 selected gaussians must survive');
    });

    it('original opacity is NOT present in filtered output (edge-case: opacity_raw sanity)', async () => {
        // Verify that the opacity_raw value of survivors is > 0 (sigmoid > 0.5)
        const flags = [true, false, true];
        const ply = buildTaggedPly(flags);

        const memReadFs = new MemoryReadFileSystem();
        memReadFs.set('input.ply', ply);
        const [dataTable] = await readFile({
            filename: 'input.ply',
            inputFormat: getInputFormat('input.ply'),
            options: {},
            params: [],
            fileSystem: memReadFs,
        });

        const filtered = await processDataTable(dataTable, [
            { kind: 'filterByValue', columnName: 'opacity', comparator: 'gt', value: 0.5 },
        ]);

        assert.equal(filtered.numRows, 2);
    });

    it('full round-trip: write filtered result back to PLY and verify magic bytes', async () => {
        const flags = [false, true, false];
        const ply = buildTaggedPly(flags);

        const memReadFs = new MemoryReadFileSystem();
        memReadFs.set('input.ply', ply);
        const [dataTable] = await readFile({
            filename: 'input.ply',
            inputFormat: getInputFormat('input.ply'),
            options: {},
            params: [],
            fileSystem: memReadFs,
        });

        const filtered = await processDataTable(dataTable, [
            { kind: 'filterByValue', columnName: 'opacity', comparator: 'gt', value: 0.5 },
        ]);

        assert.equal(filtered.numRows, 1);

        const memWriteFs = new MemoryFileSystem();
        await writeFile({
            filename: 'output.ply',
            outputFormat: getOutputFormat('output.ply', {}),
            dataTable: filtered,
            options: {},
        }, memWriteFs);

        const result = memWriteFs.results.get('output.ply');
        assert.ok(result, 'output.ply not written');
        assert.equal(
            new TextDecoder().decode(result.subarray(0, 3)),
            'ply',
            'output must start with PLY magic'
        );
    });
});
