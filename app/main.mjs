/**
 * main.mjs — Ponto de entrada do app PlayCanvas Engine standalone.
 *
 * Fluxo:
 *  1. Cria o GraphicsDevice de forma assíncrona (pc.createGraphicsDevice).
 *  2. Inicializa pc.AppBase com pc.AppOptions, registrando explicitamente
 *     GSplatComponentSystem e GSplatHandler (obrigatório para .ply).
 *  3. Carrega o .ply informado via query string (?splat=<url>).
 *  4. Adiciona câmera de órbita (camera-controls.mjs) para inspeção no desktop.
 *  5. Anexa o script VrMasker à entidade câmera.
 *  6. Expõe botão de entrada em VR se WebXR estiver disponível.
 */

import * as pc from '../engine/build/playcanvas.mjs';
import CameraControls from '../engine/scripts/esm/camera-controls.mjs';
import { VrMaskerScript, BRIDGE_DEFAULT_URL } from './scripts/vr-masker.mjs';

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------
const statusEl = document.getElementById('status');
const selectedEl = document.getElementById('selected-count');
const inputSourceEl = document.getElementById('input-source');
const inputOpEl = document.getElementById('input-op');
const coneDebugEl = document.getElementById('cone-debug');
const reticleEl = document.getElementById('reticle');
const enterVrBtn = document.getElementById('enter-vr');

function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    console.log('[app]', msg);
}

// ---------------------------------------------------------------------------
// Criação do GraphicsDevice (assíncrono — obrigatório para AppBase)
// ---------------------------------------------------------------------------
const canvas = document.getElementById('application-canvas');

const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: ['webgl2', 'webgl1'],
    antialias: false,   // GSplat não se beneficia de MSAA
    xrCompatible: true
});
device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

// ---------------------------------------------------------------------------
// Inicialização do AppBase com sistemas e handlers explícitos
// ---------------------------------------------------------------------------
const createOptions = new pc.AppOptions();
createOptions.graphicsDevice = device;
createOptions.mouse    = new pc.Mouse(document.body);
createOptions.touch    = new pc.TouchDevice(document.body);
createOptions.keyboard = new pc.Keyboard(window);
createOptions.gamepads = new pc.GamePads();
createOptions.xr = pc.XrManager;

createOptions.componentSystems = [
    pc.RenderComponentSystem,
    pc.CameraComponentSystem,
    pc.LightComponentSystem,
    pc.ScriptComponentSystem,
    pc.GSplatComponentSystem   // OBRIGATÓRIO para renderizar .ply
];
createOptions.resourceHandlers = [
    pc.TextureHandler,
    pc.ContainerHandler,
    pc.ScriptHandler,
    pc.GSplatHandler           // OBRIGATÓRIO para carregar .ply como gsplat
];

const app = new pc.AppBase(canvas);
app.init(createOptions);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

const resize = () => app.resizeCanvas();
window.addEventListener('resize', resize);
app.on('destroy', () => window.removeEventListener('resize', resize));

// ---------------------------------------------------------------------------
// Entidade câmera com órbita (desktop) e VrMasker
// ---------------------------------------------------------------------------
pc.registerScript(CameraControls, 'cameraControls');
pc.registerScript(VrMaskerScript, 'vrMasker');

const cameraEntity = new pc.Entity('Camera');
cameraEntity.addComponent('camera', {
    clearColor: new pc.Color(0.1, 0.1, 0.15),
    toneMapping: pc.TONEMAP_ACES
});
cameraEntity.setLocalPosition(0, 1.0, 3);
cameraEntity.addComponent('script');

// Câmera de órbita para inspeção desktop
cameraEntity.script.create('cameraControls');

// Script de máscara VR
const maskerInstance = cameraEntity.script.create('vrMasker', {
    properties: {
        coneAngleDeg: 30,
        coneRange: 5,
        bridgeUrl: BRIDGE_DEFAULT_URL,
        autoSendOnStop: true
    }
});

maskerInstance.on('selected:update', (count) => {
    if (selectedEl) selectedEl.textContent = `Selecionados: ${count}`;
});
maskerInstance.on('bridge:success', (result) => {
    setStatus(`Bridge OK — ${result.outputBytes} bytes`);
});
maskerInstance.on('bridge:error', (err) => {
    setStatus(`Erro bridge: ${err}`);
});
maskerInstance.on('input:update', (state) => {
    if (inputSourceEl) inputSourceEl.textContent = `Fonte: ${state.sourceType}`;
    if (inputOpEl) inputOpEl.textContent = `Modo: ${state.operation}`;
    if (coneDebugEl) {
        coneDebugEl.textContent = `Cone: angle=${state.coneAngleDeg.toFixed(1)} range=${state.coneRange.toFixed(2)}`;
    }

    if (reticleEl && app.graphicsDevice && canvas) {
        if (!state.cursorActive) {
            reticleEl.style.display = 'none';
            return;
        }

        const cssScaleX = app.graphicsDevice.width / Math.max(1, canvas.clientWidth);
        const cssScaleY = app.graphicsDevice.height / Math.max(1, canvas.clientHeight);

        const x = state.cursorX / cssScaleX;
        const y = state.cursorY / cssScaleY;

        reticleEl.style.display = 'block';
        reticleEl.style.left = `${x}px`;
        reticleEl.style.top = `${y}px`;
        reticleEl.style.borderColor = state.operation === 'remove' ? '#f05050' : (state.operation === 'add' ? '#43d67a' : '#4ec9ff');
    }
});

app.root.addChild(cameraEntity);

// ---------------------------------------------------------------------------
// Luz direcional
// ---------------------------------------------------------------------------
const lightEntity = new pc.Entity('DirectionalLight');
lightEntity.addComponent('light', { type: 'directional', intensity: 1 });
lightEntity.setEulerAngles(45, 30, 0);
app.root.addChild(lightEntity);

// ---------------------------------------------------------------------------
// Carregar splat via query string ?splat=<url>
// ---------------------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const splatUrl = params.get('splat');

app.start();

if (splatUrl) {
    setStatus('Carregando splat...');
    const splatAsset = new pc.Asset('splat', 'gsplat', { url: splatUrl });
    app.assets.add(splatAsset);
    app.assets.load(splatAsset);
    splatAsset.on('load', () => {
        const splatEntity = new pc.Entity('Splat');
        splatEntity.addComponent('gsplat', { asset: splatAsset });
        app.root.addChild(splatEntity);
        maskerInstance.setSplatEntity(splatEntity);
        setStatus('Splat carregado. Pronto.');
    });
    splatAsset.on('error', (err) => {
        setStatus(`Erro ao carregar splat: ${err}`);
    });
} else {
    setStatus('Sem splat — passe ?splat=<url> na URL');
}

// ---------------------------------------------------------------------------
// Botão de entrada em VR
// ---------------------------------------------------------------------------
const xrLocalFloor = pc.XRSPACE_LOCALFLOOR || 'local-floor';

if (app.xr && app.xr.supported) {
    const updateVrButton = () => {
        if (app.xr.active) {
            enterVrBtn.textContent = 'Sair do VR';
            enterVrBtn.disabled = false;
            return;
        }

        const available = typeof app.xr.isAvailable === 'function'
            ? app.xr.isAvailable(pc.XRTYPE_VR)
            : false;

        enterVrBtn.textContent = available ? 'Entrar em VR' : 'VR indisponível no runtime';
        enterVrBtn.disabled = !available;
    };

    updateVrButton();

    app.xr.on('start', () => {
        setStatus('Sessão VR iniciada.');
        updateVrButton();
    });

    app.xr.on('end', () => {
        setStatus('Sessão VR encerrada.');
        updateVrButton();
    });

    app.xr.on(`available:${pc.XRTYPE_VR}`, () => {
        updateVrButton();
    });

    enterVrBtn.addEventListener('click', () => {
        if (!app.xr.active) {
            if (!app.xr.isAvailable(pc.XRTYPE_VR)) {
                setStatus('VR indisponível: verifique headset conectado e runtime OpenXR ativo (SteamVR).');
                updateVrButton();
                return;
            }

            app.xr.start(cameraEntity.camera, pc.XRTYPE_VR, xrLocalFloor, {
                callback: (err) => {
                    if (err) {
                        setStatus(`Erro XR: ${err.message}`);
                    }
                    updateVrButton();
                }
            });
        } else {
            app.xr.end();
        }
    });
} else {
    enterVrBtn.textContent = 'WebXR não disponível';
    enterVrBtn.disabled = true;
}
