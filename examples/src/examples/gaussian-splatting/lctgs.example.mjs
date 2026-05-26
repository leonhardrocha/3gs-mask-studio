import { data } from 'examples/observer';
import { deviceType, rootPath, localImport } from 'examples/utils';
import * as pc from 'playcanvas';

// @config WEBGPU_DISABLED

// @config DESCRIPTION <span style="color:yellow"><b>LCTGS:</b> Merge of paint + xr-hands + vr-movement + controller model visualization.</span><br>RMB paint on desktop, XR paint/movement in VR.

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('application-canvas'));
window.focus();

const gfxOptions = {
    deviceTypes: [deviceType],
    antialias: false,
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
    pc.GSplatComponentSystem,
    pc.ModelComponentSystem
];
createOptions.resourceHandlers = [
    pc.TextureHandler,
    pc.ContainerHandler,
    pc.ScriptHandler,
    pc.GSplatHandler
];

const app = new pc.AppBase(canvas);
app.init(createOptions);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

const {
    createLctgsAssets,
    loadAssets
} = await localImport('assets.mjs');

const {
    createControllerEntity,
    getPreferredPaintInputSource,
    updateControllers
} = await localImport('hands.mjs');

const {
    createMovementState,
    updateMovementFromControllers
} = await localImport('movement.mjs');

const {
    createPaintSystem
} = await localImport('paint.mjs');

const {
    initializeLctgsState
} = await localImport('state.mjs');

const {
    bindXrButtons,
    injectXrUi,
    startXrSession,
    setXrMessage,
    toggleVrSession
} = await localImport('xr.mjs');

const resize = () => app.resizeCanvas();
window.addEventListener('resize', resize);
app.on('destroy', () => {
    window.removeEventListener('resize', resize);
});

initializeLctgsState();

const assets = createLctgsAssets();
Object.values(assets).forEach((asset) => app.assets.add(asset));
await loadAssets(app, assets);

app.start();
let paintSystem = null;
let paintInitialized = false;

const ensurePaintInitialized = () => {
    if (paintInitialized) {
        return;
    }

    paintInitialized = true;
    paintSystem = createPaintSystem({ app, device, data });

    paintSystem.createPaintableSplat('biker1', assets.biker, [-1.9, -0.55, 0.6], [180, -90, 0], [0.3, 0.3, 0.3]);
    paintSystem.registerVisibilityItem('biker1', 'Biker 1');

    paintSystem.createPaintableSplat('biker2', assets.biker, [-3.0, -0.5, -0.5], [180, 180, 0], [0.3, 0.3, 0.3]);
    paintSystem.registerVisibilityItem('biker2', 'Biker 2');

    paintSystem.createPaintableSplat('apartment', assets.apartment, [1.0, -0.5, -3], [180, 0, 0], [0.5, 0.5, 0.5]);
    paintSystem.registerVisibilityItem('apartment', 'Apartment');

    paintSystem.createPaintableSplat('sample-label-only', assets.sampleLabelOnlyCompact, [-1.7, 0.7, -0.7], [180, 180, 180], [1.0, 1.0, 1.0]);
    paintSystem.registerVisibilityItem('sample-label-only', 'Sample Label');

    paintSystem.syncAssetVisibility();
    paintSystem.updatePaintColor();
    paintSystem.syncLabelViewer();
    setXrMessage('VR active. Paint system loaded.');
};

const movementState = createMovementState();
const controllers = [];
const xrOverlay = injectXrUi();

const cameraParent = new pc.Entity('CameraParent');
app.root.addChild(cameraParent);

const camera = new pc.Entity('Camera');
camera.addComponent('camera', {
    fov: 90,
    clearColor: new pc.Color(44 / 255, 62 / 255, 80 / 255),
    toneMapping: pc.TONEMAP_LINEAR
});
cameraParent.addChild(camera);

const cameraPos = new pc.Vec3(-0.98, 0.28, -2.31);
const focusPos = new pc.Vec3(-1.1, 0.13, -1.56);
camera.setLocalPosition(cameraPos);
camera.lookAt(focusPos);

camera.addComponent('script');
const orbitCamera = camera.script.create('orbitCamera', {
    attributes: {
        frameOnStart: false,
        inertiaFactor: 0.07
    }
});
camera.script.create('orbitCameraInputMouse');
orbitCamera.resetAndLookAtPoint(cameraPos, focusPos);

const light = new pc.Entity('Light');
light.addComponent('light', {
    type: 'directional',
    castShadows: true,
    shadowBias: 0.05,
    normalOffsetBias: 0.05,
    shadowDistance: 8
});
light.setEulerAngles(45, 135, 0);
app.root.addChild(light);

const onRendererSet = () => {
    app.scene.gsplat.renderer = data.get('renderer');
    const current = app.scene.gsplat.currentRenderer;
    if (current !== data.get('renderer')) {
        setTimeout(() => data.set('renderer', current), 0);
    }
};

data.on('renderer:set', onRendererSet);
data.set('renderer', pc.GSPLAT_RENDERER_AUTO);

data.on('paintColor:set', () => paintSystem?.updatePaintColor());
data.on('paintIntensity:set', () => paintSystem?.updatePaintColor());
data.on('labelViewerEnabled:set', () => paintSystem?.syncLabelViewer());
data.on('labelBlend:set', () => paintSystem?.syncLabelViewer());
data.on('labelColorMapMode:set', () => paintSystem?.syncLabelViewer());
data.on('toggleLabelViewer', () => data.set('labelViewerEnabled', !data.get('labelViewerEnabled')));

const addDynamicAsset = (url) => {
    const normalizedUrl = `${url ?? ''}`.trim();
    if (!normalizedUrl) {
        return;
    }

    if (!paintSystem) {
        setXrMessage('Paint is locked until VR session starts.');
        return;
    }

    const fullUrl = `${rootPath}/static/assets/splats/${normalizedUrl}`;
    const uniqueId = Date.now();
    const entityName = `dynamic-asset-${uniqueId}`;
    const asset = new pc.Asset(entityName, 'gsplat', { url: fullUrl });

    app.assets.add(asset);

    asset.once('ready', () => {
        paintSystem.createPaintableSplat(entityName, asset, [0, -0.5, -1.5], [180, 0, 0], [0.35, 0.35, 0.35]);
        paintSystem.registerVisibilityItem(entityName, asset.name);
        paintSystem.syncAssetVisibility();
        paintSystem.updatePaintColor();
        paintSystem.syncLabelViewer();
        data.set('newAssetUrl', '');
    });

    asset.once('error', () => {
        app.assets.remove(asset);
        setXrMessage(`Asset load failed: ${normalizedUrl}`);
    });

    app.assets.load(asset);
};

data.on('addAsset', addDynamicAsset);

const onVisibilityItemToggle = () => {
    paintSystem?.syncAssetVisibility();
};

const visibilityItems = data.get('assetVisibilityItems') ?? [];
for (const item of visibilityItems) {
    data.on(`${item.path}:set`, onVisibilityItemToggle);
}

data.on('assetVisibilityItems:set', () => {
    const items = data.get('assetVisibilityItems') ?? [];
    for (const item of items) {
        data.on(`${item.path}:set`, onVisibilityItemToggle);
    }
});

const colorCamera = new pc.Color(44 / 255, 62 / 255, 80 / 255);
const colorTransparent = new pc.Color(0, 0, 0, 0);

const reportXrState = (prefix = 'XR') => {
    const xr = app.xr;
    const supported = !!xr?.supported;
    const vrAvailable = supported ? xr.isAvailable(pc.XRTYPE_VR) : false;
    const active = !!xr?.active;
    const activeType = active ? xr.type : 'none';
    setXrMessage(`${prefix} | supported=${supported} vrAvailable=${vrAvailable} active=${active} type=${activeType} controls=${controllers.length}`);
};

const requestDefaultVrStart = () => {
    startXrSession({
        app,
        cameraEntity: camera,
        type: pc.XRTYPE_VR,
        colorCamera,
        colorTransparent
    });
};

const onKeyDown = (event) => {
    if (event.altKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        data.set('labelViewerEnabled', !data.get('labelViewerEnabled'));
    }

    if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        toggleVrSession({
            app,
            cameraEntity: camera,
            colorCamera,
            colorTransparent
        });
    }

    if (event.key === pc.KEY_ESCAPE && app.xr?.active) {
        app.xr.end();
    }
};
window.addEventListener('keydown', onKeyDown);

const unbindXrButtons = bindXrButtons({
    app,
    cameraEntity: camera,
    colorCamera,
    colorTransparent
});

if (app.xr?.supported) {
    app.xr.on('available', () => reportXrState('XR available event'));
    app.xr.on('start', () => {
        if (app.xr?.type === pc.XRTYPE_VR) {
            ensurePaintInitialized();
            data.set('xrPaintEnabled', true);
        }
        reportXrState('XR session started');
    });
    app.xr.on('end', () => reportXrState('XR session ended'));
}

if (app.xr?.supported) {
    app.xr.input.on('add', (inputSource) => {
        const entity = createControllerEntity({
            cameraParent,
            inputSource,
            controllerModelEnabled: !!data.get('controllerModelEnabled'),
            controllerModelAsset: assets.controllerGlb
        });

        controllers.push(entity);

        inputSource.on('remove', () => {
            const idx = controllers.indexOf(entity);
            if (idx >= 0) {
                controllers.splice(idx, 1);
            }
            entity.destroy();
            reportXrState('XR input removed');
        });

        reportXrState('XR input added');
    });

    const tryAutoStartOnGesture = () => {
        if (!app.xr?.active && app.xr?.isAvailable(pc.XRTYPE_VR)) {
            requestDefaultVrStart();
        }
    };

    window.addEventListener('pointerdown', tryAutoStartOnGesture, { once: true });
    window.addEventListener('keydown', tryAutoStartOnGesture, { once: true });
    requestDefaultVrStart();
    reportXrState('Initial XR state');
} else {
    setXrMessage('WebXR is not supported');
}

const xrBrushPoint = new pc.Vec3();
app.on('update', (dt) => {
    paintSystem?.processPendingPaints();

    if (!app.xr?.active) {
        return;
    }

    if (data.get('xrMovementEnabled')) {
        updateMovementFromControllers({
            controllers,
            cameraEntity: camera,
            cameraParent,
            dt,
            movementState
        });
    }

    updateControllers({
        app,
        controllers,
        rayVisible: !!data.get('xrRayVisible')
    });

    if (paintSystem && data.get('xrPaintEnabled') && app.xr?.type === pc.XRTYPE_VR) {
        const inputSource = getPreferredPaintInputSource(controllers);
        if (inputSource && (inputSource.selecting || inputSource.squeezing)) {
            xrBrushPoint.copy(inputSource.getDirection()).mulScalar(1.6).add(inputSource.getOrigin());
            paintSystem.queuePaintPoint(xrBrushPoint, data.get('brushSize'));
        }
    }
});

app.on('destroy', () => {
    paintSystem?.destroy();
    unbindXrButtons();
    xrOverlay.destroy();
    window.removeEventListener('keydown', onKeyDown);
});

export { app };
