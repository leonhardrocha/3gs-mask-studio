import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bridgeDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(bridgeDir, '..', '..');

const assert = (cond, message) => {
    if (!cond) {
        throw new Error(message);
    }
};

const waitForServerReady = (child, timeoutMs = 20000) => {
    return new Promise((resolve, reject) => {
        let done = false;

        const timer = setTimeout(() => {
            if (!done) {
                done = true;
                reject(new Error(`Bridge server did not start within ${timeoutMs}ms`));
            }
        }, timeoutMs);

        const onData = (data) => {
            const text = data.toString();
            if (text.includes('[bridge] running on')) {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    resolve();
                }
            }
        };

        child.stdout.on('data', onData);
        child.stderr.on('data', (data) => {
            if (!done) {
                done = true;
                clearTimeout(timer);
                reject(new Error(`Bridge stderr before ready: ${data.toString()}`));
            }
        });

        child.on('exit', (code) => {
            if (!done) {
                done = true;
                clearTimeout(timer);
                reject(new Error(`Bridge exited early with code ${code}`));
            }
        });
    });
};

const pickCliCopyCommand = () => {
    if (process.platform === 'win32') {
        return 'cmd /c copy /Y {input} {output} > nul';
    }
    return 'cp {input} {output}';
};

const run = async () => {
    console.log('[smoke] checking plugin integration points...');

    const mainTsPath = path.join(repoRoot, 'supersplat', 'src', 'main.ts');
    const vrMaskerPath = path.join(repoRoot, 'supersplat', 'src', 'plugins', 'mask-tool', 'vr-masker.ts');

    const mainTs = readFileSync(mainTsPath, 'utf8');
    const vrMasker = readFileSync(vrMaskerPath, 'utf8');

    assert(mainTs.includes("toolManager.register('vrMasker'"), 'Missing vrMasker registration in supersplat/src/main.ts');
    assert(vrMasker.includes("events.on('vrMasker.select.once'"), 'Missing vrMasker select event hook in vr-masker.ts');

    console.log('[smoke] plugin wiring looks good.');
    console.log('[smoke] starting bridge server...');

    const port = 3101;
    const child = spawn('node', ['index.js'], {
        cwd: bridgeDir,
        env: {
            ...process.env,
            PORT: String(port),
            MASK_OUTPUT_EXT: '.ply',
            MASK_CLI_CMD: pickCliCopyCommand(),
            MASK_KEEP_TEMP: 'true'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
        await waitForServerReady(child);

        console.log('[smoke] posting binary PLY payload...');

        const payload = Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex 0\nend_header\n', 'utf8');

        const response = await fetch(`http://localhost:${port}/process-mask`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream'
            },
            body: payload
        });

        assert(response.ok, `Bridge returned non-OK status: ${response.status}`);

        const body = await response.json();
        assert(body.ok === true, 'Bridge response did not contain ok=true');
        assert(typeof body.outputPath === 'string' && body.outputPath.endsWith('.ply'), 'Bridge outputPath is not a .ply file');
        assert(existsSync(body.outputPath), `Bridge output file does not exist: ${body.outputPath}`);

        const out = readFileSync(body.outputPath);
        const magic = out.subarray(0, 3).toString('utf8');
        assert(magic === 'ply', `Output file is not PLY (magic='${magic}')`);

        console.log('[smoke] success: plugin/bridge minimal flow is valid.');
    } finally {
        if (!child.killed) {
            child.kill('SIGTERM');
        }
    }
};

run().catch((err) => {
    console.error(`[smoke] failed: ${err.message}`);
    process.exit(1);
});
