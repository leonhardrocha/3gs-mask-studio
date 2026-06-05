import * as pc from 'playcanvas';

import { data } from './observer.mjs';
import { deviceType, rootPath } from './config.mjs';
import { buildControls } from './controls.mjs';
import { createSelectionSystem } from './selection/selection-system.mjs';
import { createDesktopBrushInput } from './selection/brush-input.mjs';
import { createEditSystem } from './edit/edit-system.mjs';
import { exportPly } from './export/ply-exporter.mjs';
import { createXrSession } from './xr/xr-session.mjs';

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

const resize = () => app.resizeCanvas();
window.addEventListener('resize', resize);
app.on('destroy', () => window.removeEventListener('resize', resize));

// --- Default control state --------------------------------------------------
data.set('brushSize', 0.15);
data.set('selectionMode', 'additive');       // 'additive' | 'subtractive'
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
data.set('xrMoveSpeed', 1.5);

buildControls(data);

const assets = {
    orbit: new pc.Asset('script', 'script', { url: `${rootPath}/static/scripts/camera/orbit-camera.js` }),
    biker: new pc.Asset('biker', 'gsplat', { url: `${rootPath}/static/assets/splats/biker.compressed.ply` }),
    apartment: new pc.Asset('apartment', 'gsplat', { url: `${rootPath}/static/assets/splats/apartment.sog` }),
    sampleLabelOnlyCompact: new pc.Asset('sample_label_only_compact', 'gsplat', { url: `${rootPath}/static/assets/splats/sample_label_only_compact.ply` })
};

const assetListLoader = new pc.AssetListLoader(Object.values(assets), app.assets);
assetListLoader.load(() => {
    app.start();

    // Renderer selector (Auto / Raster CPU / Raster GPU / Compute)
    data.on('renderer:set', () => {
        app.scene.gsplat.renderer = data.get('renderer');
        const current = app.scene.gsplat.currentRenderer;
        if (current !== data.get('renderer')) {
            setTimeout(() => data.set('renderer', current), 0);
        }
    });
    data.set('renderer', pc.GSPLAT_RENDERER_AUTO);

    // --- Selection system ---------------------------------------------------
    const system = createSelectionSystem({ app, device, data });

    system.createSelectableSplat('biker1', assets.biker, [-1.9, -0.55, 0.6], [180, -90, 0], [0.3, 0.3, 0.3]);
    system.registerVisibilityItem('biker1', 'Biker 1');
    system.createSelectableSplat('biker2', assets.biker, [-3, -0.5, -0.5], [180, 180, 0], [0.3, 0.3, 0.3]);
    system.registerVisibilityItem('biker2', 'Biker 2');
    system.createSelectableSplat('apartment', assets.apartment, [1.0, -0.5, -3], [180, 0, 0], [0.5, 0.5, 0.5]);
    system.registerVisibilityItem('apartment', 'Apartment');
    system.createSelectableSplat('sample-label-only', assets.sampleLabelOnlyCompact, [-1.7, 0.7, -0.7], [180, 180, 180], [1.0, 1.0, 1.0]);
    system.registerVisibilityItem('sample-label-only', 'Sample Label');
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

    camera.addComponent('script');
    const orbitCamera = camera.script.create('orbitCamera', {
        attributes: { frameOnStart: false, inertiaFactor: 0.07 }
    });
    const orbitInput = camera.script.create('orbitCameraInputMouse');
    orbitCamera.resetAndLookAtPoint(cameraPos, focusPos);

    // --- Edit system (transform / recolor selection) ------------------------
    const editSystem = createEditSystem({ system, data });

    // --- Desktop brush input ------------------------------------------------
    const brushInput = createDesktopBrushInput({ app, canvas, camera, orbitInput, system, data });

    // --- XR session (controller-ray selection) ------------------------------
    const xrSession = createXrSession({ app, camera, cameraParent, system, data });
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
        system.processPending();
    });

    app.on('destroy', () => {
        brushInput.destroy();
        xrSession.destroy();
        system.destroy();
        window.removeEventListener('keydown', onKeyDown);
    });
});

export { app };
