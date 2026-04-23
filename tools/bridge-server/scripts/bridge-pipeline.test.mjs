import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');
const ST_CLI = path.resolve(SERVER_ROOT, '../../splat-transform/bin/cli.mjs');

const PLY_PROPS = [
    'x', 'y', 'z',
    'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3',
    'f_dc_0', 'f_dc_1', 'f_dc_2',
    'opacity'
];

const buildValidPly = () => {
    const n = 1;
    const propLines = PLY_PROPS.map((p) => `property float ${p}`).join('\n');
    const header = [
        'ply',
        'format binary_little_endian 1.0',
        `element vertex ${n}`,
        propLines,
        'end_header',
        ''
    ].join('\n');

    const headerBytes = Buffer.from(header, 'utf8');
    const out = Buffer.alloc(headerBytes.length + n * PLY_PROPS.length * 4);
    headerBytes.copy(out, 0);

    let offset = headerBytes.length;
    for (const prop of PLY_PROPS) {
        const value = prop === 'rot_0' ? 1.0 : 0.0;
        out.writeFloatLE(value, offset);
        offset += 4;
    }

    return out;
};

const waitForReady = (child, timeoutMs = 20000) => new Promise((resolve, reject) => {
    let done = false;

    const timer = setTimeout(() => {
        if (!done) {
            done = true;
            reject(new Error(`bridge did not start in ${timeoutMs}ms`));
        }
    }, timeoutMs);

    const onData = (chunk) => {
        const text = String(chunk || '');
        if (!done && text.includes('[bridge] running on')) {
            done = true;
            clearTimeout(timer);
            resolve();
        }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
        if (!done) {
            done = true;
            clearTimeout(timer);
            reject(err);
        }
    });
    child.on('exit', (code) => {
        if (!done) {
            done = true;
            clearTimeout(timer);
            reject(new Error(`bridge exited before ready with code ${code}`));
        }
    });
});

const withServer = async (env, fn) => {
    const port = Number(env.PORT);
    const child = spawn(process.execPath, ['index.js'], {
        cwd: SERVER_ROOT,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
        await waitForReady(child);
        return await fn(port);
    } finally {
        if (child.exitCode === null) {
            child.kill('SIGTERM');
        }
    }
};

describe('bridge pipeline', () => {
    it('keeps legacy behavior when only MASK_CLI_CMD is configured', async () => {
        const env = {
            PORT: '3191',
            MASK_CLI_CMD: `${process.execPath} "${ST_CLI}" -w {input} {output}`,
            MASK_KEEP_TEMP: 'true'
        };

        await withServer(env, async (port) => {
            const response = await fetch(`http://127.0.0.1:${port}/process-mask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buildValidPly()
            });

            const text = await response.text();
            assert.equal(response.status, 200, text);
            const json = JSON.parse(text);
            assert.equal(json.ok, true);
            assert.equal(typeof json.outputPath, 'string');
            assert.ok(fs.existsSync(json.outputPath), 'output file should exist in legacy mode');
        });
    });

    it('returns 501 when pipeline mode is partially configured', async () => {
        const env = {
            PORT: '3192',
            SELECT_CLI_CMD: `${process.execPath} "${ST_CLI}" -w {input} {selected}`,
            MASK_CLI_CMD: `${process.execPath} "${ST_CLI}" -w {selected} {masked}`
        };

        await withServer(env, async (port) => {
            const response = await fetch(`http://127.0.0.1:${port}/process-mask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: buildValidPly()
            });

            const text = await response.text();
            assert.equal(response.status, 501, text);
            const json = JSON.parse(text);
            assert.equal(json.ok, false);
            assert.match(json.error, /Pipeline mode requires/i);
        });
    });

    it('runs full pipeline when SELECT/MASK/EXPORT are configured', async () => {
        const env = {
            PORT: '3193',
            SELECT_CLI_CMD: `${process.execPath} "${ST_CLI}" -w {input} {selected}`,
            MASK_CLI_CMD: `${process.execPath} "${ST_CLI}" -w {selected} {masked}`,
            EXPORT_CLI_CMD: `${process.execPath} "${ST_CLI}" -w {masked} {output}`,
            MASK_KEEP_TEMP: 'true'
        };

        await withServer(env, async (port) => {
            const response = await fetch(`http://127.0.0.1:${port}/process-mask`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'x-input-filename': 'scene.ply'
                },
                body: buildValidPly()
            });

            const text = await response.text();
            assert.equal(response.status, 200, text);
            const json = JSON.parse(text);
            assert.equal(json.ok, true);
            assert.equal(Array.isArray(json.steps), true);
            assert.equal(json.steps.length, 3, 'pipeline should execute 3 steps');
            assert.ok(fs.existsSync(json.outputPath), 'final output should exist');
        });
    });
});
