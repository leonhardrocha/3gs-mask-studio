/**
 * Fase 5 — Round-trip integration test.
 *
 * Verifies the full pipeline:
 *   1. Build a tagged PLY (3 selected + 2 non-selected gaussians)
 *   2. POST it to a live bridge server running the real splat-transform filter
 *   3. Parse the JSON response and verify outputBytes > 0
 *
 * The test spawns its own ephemeral bridge server on port 3099 (override via
 * ROUND_TRIP_PORT env var) and tears it down after the suite finishes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

const BRIDGE_PORT = Number(process.env.ROUND_TRIP_PORT || 3099);
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}/process-mask`;

// ---------------------------------------------------------------------------
// Helpers — minimal PLY builder
// ---------------------------------------------------------------------------

const PLY_PROPS = [
    'x', 'y', 'z',
    'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3',
    'f_dc_0', 'f_dc_1', 'f_dc_2',
    'opacity',
];

/**
 * Build a minimal binary-LE PLY.
 * @param {boolean[]} selectedFlags
 * @returns {Buffer}
 */
function buildTaggedPly(selectedFlags) {
    const n = selectedFlags.length;
    const propLines = PLY_PROPS.map(p => `property float ${p}`).join('\n');
    const header = [
        'ply',
        'format binary_little_endian 1.0',
        `element vertex ${n}`,
        propLines,
        'end_header',
        '',
    ].join('\n');

    const headerBytes = Buffer.from(header, 'utf8');
    const bytesPerVertex = PLY_PROPS.length * 4;
    const out = Buffer.alloc(headerBytes.length + n * bytesPerVertex);
    headerBytes.copy(out, 0);

    let offset = headerBytes.length;
    for (let i = 0; i < n; i++) {
        for (const prop of PLY_PROPS) {
            const val = prop === 'opacity' ? (selectedFlags[i] ? 100.0 : -100.0) : 0.0;
            out.writeFloatLE(val, offset);
            offset += 4;
        }
    }
    return out;
}

/**
 * Parse vertex count from binary/ascii PLY header.
 * @param {Buffer} plyBuffer
 * @returns {number}
 */
function parseVertexCount(plyBuffer) {
    const endHeader = '\nend_header\n';
    const endHeaderIndex = plyBuffer.indexOf(endHeader);
    assert.notEqual(endHeaderIndex, -1, 'PLY header must contain end_header');

    const header = plyBuffer.subarray(0, endHeaderIndex + endHeader.length).toString('utf8');
    const match = header.match(/\nelement vertex\s+(\d+)\n/);
    assert.ok(match, 'PLY header must contain element vertex <n>');

    return Number(match[1]);
}

// ---------------------------------------------------------------------------
// Spawn / teardown bridge server
// ---------------------------------------------------------------------------

let serverProc;

before(() => new Promise((resolve, reject) => {
    const stCli = path.resolve(SERVER_ROOT, '../../splat-transform/bin/cli.mjs');

    serverProc = spawn(process.execPath, ['index.js'], {
        cwd: SERVER_ROOT,
        env: {
            ...process.env,
            PORT: String(BRIDGE_PORT),
            MASK_CLI_CMD: `node "${stCli}" -w {input} -V opacity,gt,0.5 {output}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;
    const onData = (chunk) => {
        if (!started && String(chunk).includes('running on')) {
            started = true;
            resolve();
        }
    };
    serverProc.stdout.on('data', onData);
    serverProc.stderr.on('data', onData);
    serverProc.on('error', reject);
    serverProc.on('exit', (code) => {
        if (!started) reject(new Error(`bridge exited prematurely with code ${code}`));
    });
}));

after(() => new Promise((resolve) => {
    if (!serverProc || serverProc.exitCode !== null) return resolve();
    serverProc.on('exit', resolve);
    serverProc.kill();
}));

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('round-trip: VR select → PLY export → bridge → output', () => {
    it('exactly 3 selected gaussians survive the full pipeline', async () => {
        const selected = [true, true, true, false, false];
        const plyBuffer = buildTaggedPly(selected);

        const response = await fetch(BRIDGE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: plyBuffer,
        });

        const responseText = await response.text();
        assert.equal(response.ok, true, `bridge responded ${response.status}: ${responseText}`);

        // The bridge returns JSON with an outputBytes field; the actual PLY is
        // not streamed back directly by the current server implementation.
        // We validate the server processed it correctly by checking outputBytes > 0
        // and that the JSON carries selectedCount metadata if the server emits it.
        const json = JSON.parse(responseText);
        assert.equal(typeof json.outputBytes, 'number', 'response must contain outputBytes');
        assert.ok(json.outputBytes > 0, `outputBytes should be > 0, got ${json.outputBytes}`);
        assert.equal(typeof json.outputPath, 'string', 'response must contain outputPath');

        const outputPly = fs.readFileSync(json.outputPath);
        const vertexCount = parseVertexCount(outputPly);
        assert.equal(vertexCount, 3, 'filtered output must contain exactly 3 selected gaussians');

        console.log(`[round-trip] outputBytes=${json.outputBytes} vertexCount=${vertexCount}`);
    });

    it('fails with a clear error when no gaussian is selected', async () => {
        const selected = [false, false, false, false];
        const plyBuffer = buildTaggedPly(selected);

        const response = await fetch(BRIDGE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: plyBuffer,
        });

        const responseText = await response.text();
        assert.equal(response.status, 500, `expected 500 for empty selection, got ${response.status}: ${responseText}`);

        const json = JSON.parse(responseText);
        assert.equal(json.ok, false, 'bridge response must indicate failure');
        assert.equal(typeof json.error, 'string', 'response must contain a top-level error');
        assert.match(String(json.details || ''), /No Gaussians to write/, 'error details should explain empty output');
    });
});
