import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

import { defineConfig, loadEnv } from 'vite';

const require = createRequire(import.meta.url);
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// fflate is the engine's only runtime dependency (used by the USDZ exporter,
// which we don't use but is part of the module graph). Resolve its ESM build
// explicitly because the engine source lives outside this project's node_modules.
// `require.resolve('fflate')` lands in `<pkg>/lib/node.cjs`; walk up to the
// package root and point at the browser ESM build (the package blocks the
// `./package.json` subpath, so we can't resolve that directly).
const fflateRoot = path.resolve(path.dirname(require.resolve('fflate')), '..');
const fflateEsm = path.join(fflateRoot, 'esm', 'browser.js');

export default defineConfig(({ mode }) => {
    // Load `.env` files (no prefix filter) and merge them over the real
    // environment, so `ENGINE_PATH=... npm run dev` still wins over the file.
    const env = { ...loadEnv(mode, projectRoot, ''), ...process.env };

    /**
     * Path to the LOCAL PlayCanvas engine source.
     *
     * The painting example relies on GSplat features (GSplatProcessor, work-buffer
     * modifiers, custom instance streams, Paul Tol label colormaps) that only exist
     * in this beta engine checkout — NOT in the published `playcanvas` npm package.
     * So we alias the bare `playcanvas` import directly to the engine source tree,
     * mirroring the examples' `ENGINE_PATH=../src/index.js` development flow.
     *
     * The path is machine-specific, so it is NOT hardcoded here. Set it in `.env`
     * (see `.env.example`) or pass `ENGINE_PATH=/abs/path/to/src/index.js npm run dev`.
     */
    const ENGINE_PATH = env.ENGINE_PATH;
    if (!ENGINE_PATH) {
        throw new Error(
            'ENGINE_PATH is not set. Copy .env.example to .env and point ENGINE_PATH ' +
            'at your local PlayCanvas engine source (src/index.js).'
        );
    }

    const engineSrcDir = path.dirname(ENGINE_PATH);
    const engineRoot = path.resolve(engineSrcDir, '..');

    return {
        resolve: {
            alias: {
                playcanvas: ENGINE_PATH,
                fflate: fflateEsm
            }
        },
        server: {
            // Listen on all interfaces so a LAN device / HTTPS tunnel (e.g. ngrok for
            // testing WebXR on a Quest headset) can reach the dev server.
            host: true,
            // Allow any Host header. WebXR testing goes through tunnels whose hostnames
            // rotate every session (ngrok-free, etc.); Vite 5 blocks unknown hosts by
            // default. This is a dev-only relaxation.
            allowedHosts: true,
            fs: {
                // Allow Vite to serve the engine source, which lives outside this project.
                allow: [projectRoot, engineRoot]
            },
            // Proxy the retexture service (runs on the dev-server machine at :5000).
            // Browser requests stay same-origin/HTTPS — avoids mixed-content (WebXR is
            // HTTPS) and CORS, and lets the headset reach a service bound to localhost.
            proxy: {
                // Download path FIRST (more specific). Follows service-side redirects
                // (e.g. /download_ply/Fruits → 40000.ply) so the proxy returns the
                // final file. It's a GET (no body), so the follow-redirects request
                // body limit doesn't apply.
                '/retex/download_ply': {
                    target: env.RETEXTURE_SERVICE || 'http://localhost:5000',
                    changeOrigin: true,
                    followRedirects: true,
                    rewrite: (p) => p.replace(/^\/retex/, '')
                },
                // Everything else (incl. the retexture POST). NO followRedirects here:
                // the multipart upload (large texture) exceeds follow-redirects' body
                // limit (ERR_FR_MAX_BODY_LENGTH_EXCEEDED).
                '/retex': {
                    target: env.RETEXTURE_SERVICE || 'http://localhost:5000',
                    changeOrigin: true,
                    rewrite: (p) => p.replace(/^\/retex/, '')
                }
            }
        },
        optimizeDeps: {
            // The engine is consumed as source, not a pre-bundled package.
            exclude: ['playcanvas']
        }
    };
});
