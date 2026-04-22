/**
 * main.js — Ponto de entrada do app PlayCanvas Engine standalone.
 *
 * Fluxo:
 *  1. Cria a aplicação PlayCanvas via pc.Application.
 *  2. Registra os sistemas de componentes necessários (Camera, Light, GSplat).
 *  3. Carrega o .ply/.splat informado via query string (?splat=<url>).
 *  4. Adiciona o script VrMasker à entidade câmera.
 *  5. Expõe botão de entrada em VR se WebXR estiver disponível.
 */

import * as pc from '../engine/build/playcanvas/src/index.js';
import { VrMaskerScript, BRIDGE_DEFAULT_URL } from './scripts/vr-masker.js';

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------
const statusEl = document.getElementById('status');
const selectedEl = document.getElementById('selected-count');
const enterVrBtn = document.getElementById('enter-vr');

function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
}

// ---------------------------------------------------------------------------
// Criação da aplicação
// ---------------------------------------------------------------------------
const canvas = document.getElementById('application-canvas');

const app = new pc.Application(canvas, {
    mouse: new pc.Mouse(canvas),
    touch: new pc.TouchDevice(canvas),
    keyboard: new pc.Keyboard(window),
    graphicsDeviceOptions: { antialias: true }
});

app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);

// ---------------------------------------------------------------------------
// Entidade câmera
// ---------------------------------------------------------------------------
const cameraEntity = new pc.Entity('Camera');
cameraEntity.addComponent('camera', { clearColor: new pc.Color(0.1, 0.1, 0.1) });
cameraEntity.setPosition(0, 1.6, 3);
app.root.addChild(cameraEntity);

// ---------------------------------------------------------------------------
// Luz ambiente
// ---------------------------------------------------------------------------
const lightEntity = new pc.Entity('DirectionalLight');
lightEntity.addComponent('light', { type: 'directional' });
lightEntity.setEulerAngles(45, 30, 0);
app.root.addChild(lightEntity);

// ---------------------------------------------------------------------------
// Script VrMasker — registrar e anexar à câmera
// ---------------------------------------------------------------------------
pc.registerScript(VrMaskerScript, 'vrMasker');

cameraEntity.addComponent('script');
const maskerInstance = cameraEntity.script.create('vrMasker', {
    properties: {
        coneAngleDeg: 30,
        coneRange: 5,
        bridgeUrl: BRIDGE_DEFAULT_URL,
        autoSendOnStop: true
    }
});

// Callback de progresso de seleção
maskerInstance.on('selected:update', (count) => {
    if (selectedEl) selectedEl.textContent = `Selecionados: ${count}`;
});

maskerInstance.on('bridge:success', (result) => {
    setStatus(`Bridge OK — ${result.outputBytes} bytes`);
});

maskerInstance.on('bridge:error', (err) => {
    setStatus(`Erro bridge: ${err}`);
});

// ---------------------------------------------------------------------------
// Carregar splat via query string ?splat=<url>
// ---------------------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const splatUrl = params.get('splat');

let splatEntity = null;

if (splatUrl) {
    setStatus('Carregando splat...');
    app.assets.loadFromUrl(splatUrl, 'gsplat', (err, asset) => {
        if (err) {
            setStatus(`Erro ao carregar splat: ${err}`);
            return;
        }
        splatEntity = new pc.Entity('Splat');
        splatEntity.addComponent('gsplat', { asset });
        app.root.addChild(splatEntity);
        maskerInstance.setSplatEntity(splatEntity);
        setStatus('Splat carregado. Pronto.');
    });
} else {
    setStatus('Sem splat — passe ?splat=<url> na URL');
}

// ---------------------------------------------------------------------------
// Botão de entrada em VR
// ---------------------------------------------------------------------------
if (app.xr && app.xr.supported) {
    enterVrBtn.addEventListener('click', () => {
        app.xr.start(cameraEntity.camera, pc.XRTYPE_VR, pc.XRSPACE_LOCAL_FLOOR, {
            callback: (err) => {
                if (err) setStatus(`Erro XR: ${err.message}`);
            }
        });
    });
} else {
    enterVrBtn.textContent = 'WebXR não disponível';
    enterVrBtn.disabled = true;
    setStatus('Modo desktop (sem XR)');
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.start();
