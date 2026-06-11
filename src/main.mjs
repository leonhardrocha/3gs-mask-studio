import * as pc from 'playcanvas';

import { data } from './observer.mjs';
import { deviceType, rootPath } from './config.mjs';
import { buildControls } from './controls.mjs';
import { createSelectionSystem } from './selection/selection-system.mjs';
import { createDesktopBrushInput } from './selection/brush-input.mjs';
import { createEditSystem } from './edit/edit-system.mjs';
import { exportPly } from './export/ply-exporter.mjs';
import { createXrSession } from './xr/xr-session.mjs';
import { createPerfHud } from './perf-hud.mjs';
import { createHistory } from './history.mjs';
import { createSplatIndex } from './selection/splat-index.mjs';
import { createControllerModels } from './xr/controller-models.mjs';
import { createModePanel } from './xr/mode-panel.mjs';
import { createRetexture } from './retexture.mjs';

// Expose the engine globally so the classic `orbit-camera.js` script (loaded as a
// 'script' asset) can call `pc.createScript(...)` — it expects a global `pc`.
window.pc = pc;

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('application-canvas'));
window.focus();

const gfxOptions = {
    deviceTypes: [deviceType],
    antialias: false, // gaussian splats don't benefit from MSAA
    xrCompatible: true
};

const device = await pc.createGraphicsDevice(canvas, gfxOptions);
device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

const createOptions = new pc.AppOptions();
createOptions.graphicsDevice = device;
createOptions.mouse = new pc.Mouse(document.body);
createOptions.touch = new pc.TouchDevice(document.body);
createOptions.keyboard = new pc.Keyboard(window);
createOptions.xr = pc.XrManager;

createOptions.componentSystems = [
    pc.RenderComponentSystem,
    pc.CameraComponentSystem,
    pc.LightComponentSystem,
    pc.ScriptComponentSystem,
    pc.GSplatComponentSystem
];
createOptions.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler, pc.ScriptHandler, pc.GSplatHandler];

const app = new pc.AppBase(canvas);
app.init(createOptions);

app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

// On-top UI layer: the mode panel and controller hint icons render here — after
// the World layer and with the depth buffer cleared — so gaussian splats never
// occlude them (they were sometimes drawn behind the splats).
const uiTopLayer = new pc.Layer({ name: 'UITop', clearDepthBuffer: true });
app.scene.layers.push(uiTopLayer);

const resize = () => app.resizeCanvas();
window.addEventListener('resize', resize);
app.on('destroy', () => window.removeEventListener('resize', resize));

// --- Default control state --------------------------------------------------
data.set('brushSize', 0.15);
data.set('selectionMode', 'additive');       // 'additive' | 'subtractive'
data.set('activeSelectionTarget', 'all');     // 'all' | <entity name> — brush scope
data.set('selectionColor', [1.0, 0.6, 0.0]); // highlight tint
data.set('selectionStrength', 0.7);
data.set('labelViewerEnabled', false);
data.set('labelBlend', 0.8);
data.set('labelColorMapMode', 'high-contrast');
data.set('labelColorMapScheme', 'bright');
data.set('assetVisibilityItems', []);
data.set('newAssetUrl', '');

// Edit (transform) active-op state
data.set('editing', false);
data.set('editTx', 0); data.set('editTy', 0); data.set('editTz', 0);
data.set('editRx', 0); data.set('editRy', 0); data.set('editRz', 0);
data.set('editScale', 1);
data.set('editColor', [1, 1, 1]);
data.set('editColorEnabled', false);

// XR
data.set('xrRayVisible', true);
data.set('xrRayDistance', 1.5);
data.set('xrSnapToSurface', false);
data.set('snapBeamRadius', 0.05);  // CPU-index snap precision/cell scale (m)
data.set('xrMoveSpeed', 1.5);

// Retexture tool
data.set('retextureStatus', 'pronto');
data.set('retexObjects', ['Fruits']);          // retexturizable objects available to add
data.set('retextureRunName', 'Fruits');         // selected object; also the service run_name + /download_ply/{name}
data.set('retextureTextureUrl', `${rootPath}/static/textures/white-marble.jpg`);
data.set('retextureTextureName', 'white-marble');

buildControls(data);

const assets = {
    orbit: new pc.Asset('script', 'script', { url: `${rootPath}/static/scripts/camera/orbit-camera.js` }),
    apartment: new pc.Asset('apartment', 'gsplat', { url: `${rootPath}/static/assets/splats/apartment.sog` })
};

const assetListLoader = new pc.AssetListLoader(Object.values(assets), app.assets);
assetListLoader.load(() => {
    app.start();

    // Baseline perf HUD (Fase 0): FPS/ms/copy%/sort. Toggle with `, reset with ~.
    const perfHud = createPerfHud({ app, data });

    // Renderer selector (Auto / Raster CPU / Raster GPU / Compute)
    data.on('renderer:set', () => {
        app.scene.gsplat.renderer = data.get('renderer');
        const current = app.scene.gsplat.currentRenderer;
        if (current !== data.get('renderer')) {
            setTimeout(() => data.set('renderer', current), 0);
        }
    });
    data.set('renderer', pc.GSPLAT_RENDERER_AUTO);

    // --- Undo/redo history --------------------------------------------------
    const history = createHistory({ data });

    // --- Selection system ---------------------------------------------------
    const system = createSelectionSystem({ app, device, data, history });

    system.createSelectableSplat('apartment', assets.apartment, [1.0, -0.5, -3], [180, 0, 0], [0.5, 0.5, 0.5]);
    system.registerVisibilityItem('apartment', 'Apartment');
    system.syncAssetVisibility();

    // --- Camera rig + orbit -------------------------------------------------
    // The camera is a child of a rig (cameraParent). All XR locomotion/world
    // manipulation moves the rig, never the camera (the engine writes the HMD
    // pose into the camera's local transform).
    const cameraParent = new pc.Entity('CameraParent');
    app.root.addChild(cameraParent);

    const cameraPos = new pc.Vec3(-0.98, 0.28, -2.31);
    const focusPos = new pc.Vec3(-1.1, 0.13, -1.56);

    const camera = new pc.Entity('Camera');
    camera.addComponent('camera', {
        fov: 90,
        clearColor: new pc.Color(0, 0, 0),
        toneMapping: pc.TONEMAP_LINEAR
    });
    camera.setLocalPosition(cameraPos);
    camera.lookAt(focusPos);
    cameraParent.addChild(camera);
    // Render the on-top UI layer with this camera.
    camera.camera.layers = camera.camera.layers.concat(uiTopLayer.id);

    // Lighting for non-splat meshes (controller models, fallback box). Splats are
    // self-lit (gsplat), so they're unaffected; without any light these meshes
    // render black. Ambient fills shadows; a head-mounted directional light shades.
    app.scene.ambientLight = new pc.Color(0.45, 0.47, 0.52);
    const headlight = new pc.Entity('headlight');
    headlight.addComponent('light', { type: 'directional', intensity: 1.4 });
    camera.addChild(headlight); // follows the view; forward = camera forward

    camera.addComponent('script');
    const orbitCamera = camera.script.create('orbitCamera', {
        attributes: { frameOnStart: false, inertiaFactor: 0.07 }
    });
    const orbitInput = camera.script.create('orbitCameraInputMouse');
    orbitCamera.resetAndLookAtPoint(cameraPos, focusPos);

    // --- Edit system (transform / recolor selection) ------------------------
    const editSystem = createEditSystem({ system, data, history });

    // --- Retexture tool (external service via Vite /retex proxy) -------------
    createRetexture({ app, system, editSystem, data });

    // --- Desktop brush input ------------------------------------------------
    const brushInput = createDesktopBrushInput({ app, canvas, camera, orbitInput, system, data });

    // --- Surface-snap index (Fase 1.5 spike) --------------------------------
    const splatIndex = createSplatIndex({ system, data });
    // Prebuild off the render path when snap is enabled (avoids a first-use hitch)
    // and report build cost (part of the spike measurement).
    data.on('xrSnapToSurface:set', (on) => {
        if (on) { const r = splatIndex.rebuild(); console.log(`[snap] índice CPU: ${r.count} splats em ${r.ms.toFixed(1)}ms`); }
    });

    // --- Controller models (WebXR Input Profiles, Fase 2) -------------------
    const controllerModels = createControllerModels({ app, camera, rootPath, uiLayer: uiTopLayer });

    // --- Mode panel (Fase 3) ------------------------------------------------
    const modePanel = createModePanel({ app, camera, data, uiLayer: uiTopLayer });

    // --- XR session (controller-ray selection) ------------------------------
    const xrSession = createXrSession({ app, camera, cameraParent, system, data, splatIndex, controllerModels, panel: modePanel });
    data.on('enterVR', () => xrSession.enter());

    // --- Data → system wiring ----------------------------------------------
    data.on('selectionColor:set', () => system.updateHighlight());
    data.on('selectionStrength:set', () => system.updateHighlight());
    data.on('labelViewerEnabled:set', () => system.syncLabelViewer());
    data.on('labelBlend:set', () => system.syncLabelViewer());
    data.on('labelColorMapMode:set', () => system.syncLabelViewer());
    data.on('labelColorMapScheme:set', () => system.syncLabelViewer());
    data.on('clearSelection', () => system.clear());
    data.on('invertSelection', () => system.invert());
    data.on('exportPly', (scope) => {
        exportPly({ system, editSystem, scope: scope === 'whole' ? 'whole' : 'subset' })
            .catch(err => console.error('[export] falhou:', err));
    });
    data.on('toggleLabelViewer', () => data.set('labelViewerEnabled', !data.get('labelViewerEnabled')));

    data.on('addAsset', (url) => {
        const normalizedUrl = `${url ?? ''}`.trim();
        if (!normalizedUrl) return;
        const fullUrl = `${rootPath}/static/assets/splats/${normalizedUrl}`;
        const entityName = `dynamic-asset-${Date.now()}`;
        const asset = new pc.Asset(entityName, 'gsplat', { url: fullUrl });
        app.assets.add(asset);
        asset.once('ready', () => {
            system.createSelectableSplat(entityName, asset, [0, -0.5, -1.5], [180, 0, 0], [0.35, 0.35, 0.35]);
            system.registerVisibilityItem(entityName, asset.name);
            system.syncAssetVisibility();
            data.set('newAssetUrl', '');
        });
        asset.once('error', err => console.error('Asset load failed:', fullUrl, err));
        app.assets.load(asset);
    });

    const onKeyDown = (event) => {
        if (event.altKey && event.key.toLowerCase() === 'l') {
            event.preventDefault();
            data.set('labelViewerEnabled', !data.get('labelViewerEnabled'));
        }
        // Mode panel (desktop testing): M toggles; arrows navigate; Enter confirms.
        if (event.key === 'm' || event.key === 'M') { event.preventDefault(); modePanel.toggle(); return; }
        if (modePanel.isOpen) {
            if (event.key === 'ArrowUp') { event.preventDefault(); modePanel.navVertical(-1); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); modePanel.navVertical(1); }
            else if (event.key === 'ArrowLeft') { event.preventDefault(); modePanel.navHorizontal(-1); }
            else if (event.key === 'ArrowRight') { event.preventDefault(); modePanel.navHorizontal(1); }
            else if (event.key === 'Enter') { event.preventDefault(); modePanel.activate(); }
            else if (event.key === 'Escape') { event.preventDefault(); modePanel.close(); }
        }
        // Undo (Ctrl/Cmd+Z) / Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y).
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            data.emit(event.shiftKey ? 'redo' : 'undo');
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            data.emit('redo');
        }
    };
    window.addEventListener('keydown', onKeyDown);

    // --- Update loop --------------------------------------------------------
    // Guard the XR update: a per-frame throw here would otherwise halt the render
    // loop (freezing head tracking and input). Log once, keep rendering.
    let xrUpdateErrored = false;
    app.on('update', (dt) => {
        try {
            xrSession.update(dt);
        } catch (err) {
            if (!xrUpdateErrored) {
                xrUpdateErrored = true;
                console.error('[xr] erro no update (suprimido nos próximos frames):', err);
            }
        }
        modePanel.updateFollow(dt);
        system.processPending();
    });

    app.on('destroy', () => {
        brushInput.destroy();
        xrSession.destroy();
        controllerModels.destroy();
        modePanel.destroy();
        system.destroy();
        perfHud.destroy();
        window.removeEventListener('keydown', onKeyDown);
    });
});

export { app };
