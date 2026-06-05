/**
 * App configuration — replaces the examples-browser `examples/utils` helpers.
 *
 * The original example imported `deviceType` and `rootPath` from the examples
 * framework. Here we provide standalone equivalents.
 */

/**
 * Base path used to build asset URLs. Assets live under `public/static/...`,
 * which Vite serves from the site root, so the base is empty:
 *   `${rootPath}/static/assets/splats/biker.compressed.ply`
 */
export const rootPath = '';

/**
 * Preferred graphics device.
 *
 * Defaults to WebGL2 (the painting GLSL + work-buffer shaders run everywhere
 * without extra setup). Pass `?device=webgpu` to opt into WebGPU, which unlocks
 * the GSplat compute renderer and the WGSL code paths.
 */
const DEVICE_TYPES = ['webgpu', 'webgl2', 'null'];
const requested = new URLSearchParams(window.location.search).get('device');
export const deviceType = DEVICE_TYPES.includes(requested) ? requested : 'webgl2';
