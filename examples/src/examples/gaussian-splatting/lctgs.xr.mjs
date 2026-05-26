import files from 'examples/files';
import * as pc from 'playcanvas';

const XR_UI_HTML_FALLBACK = `
<div class="lctgs-xr-container">
    <button class="lctgs-xr-button" data-xr="immersive-ar">AR</button>
    <button class="lctgs-xr-button" data-xr="immersive-vr">VR</button>
</div>
<div class="lctgs-message"></div>
`;

const XR_UI_CSS_FALLBACK = `
.lctgs-xr-container {
    position: absolute;
    left: 16px;
    bottom: 48px;
    display: flex;
    gap: 8px;
    z-index: 10;
}

.lctgs-xr-button {
    border: 1px solid #7f8c8d;
    background: rgba(30, 39, 46, 0.5);
    color: #ecf0f1;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: default;
    opacity: 0.4;
    padding: 8px 12px;
}

.lctgs-xr-button.active {
    cursor: pointer;
    opacity: 1;
}

.lctgs-xr-button.active:hover {
    background: rgba(30, 39, 46, 0.9);
}

.lctgs-message {
    position: absolute;
    left: 16px;
    bottom: 12px;
    color: #ecf0f1;
    font-size: 12px;
    background: rgba(0, 0, 0, 0.35);
    border-radius: 4px;
    padding: 6px 8px;
    z-index: 10;
}
`;

const injectXrUi = () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = files['ui.html'] || XR_UI_HTML_FALLBACK;
    document.body.appendChild(wrapper);

    const style = document.createElement('style');
    style.innerHTML = files['ui.css'] || XR_UI_CSS_FALLBACK;
    document.head.appendChild(style);

    return {
        destroy: () => {
            wrapper.remove();
            style.remove();
        }
    };
};

const setXrMessage = (msg) => {
    const el = document.querySelector('.lctgs-message');
    if (el) {
        el.textContent = msg;
    }
};

const startXrSession = ({ app, cameraEntity, type, colorCamera, colorTransparent }) => {
    const xr = app.xr;

    if (!xr) {
        setXrMessage('WebXR subsystem is unavailable.');
        return;
    }

    if (xr.active) {
        setXrMessage(`XR already active: ${xr.type}`);
        return;
    }

    if (!xr.supported) {
        setXrMessage('WebXR is not supported on this platform.');
        return;
    }

    if (!xr.isAvailable(type)) {
        setXrMessage(`${type} is not available on this device/browser.`);
        return;
    }

    cameraEntity.camera.clearColor = type === pc.XRTYPE_AR ? colorTransparent : colorCamera;

    xr.start(cameraEntity.camera, type, pc.XRSPACE_LOCALFLOOR, {
        callback: (err) => {
            if (err) {
                setXrMessage(`XR ${type} failed: ${err.message}`);
            } else {
                setXrMessage(`XR ${type} started.`);
            }
        }
    });
};

const toggleVrSession = ({ app, cameraEntity, colorCamera, colorTransparent }) => {
    const xr = app.xr;

    if (!xr) {
        setXrMessage('WebXR subsystem is unavailable.');
        return;
    }

    if (xr.active) {
        xr.end();
        return;
    }

    startXrSession({
        app,
        cameraEntity,
        type: pc.XRTYPE_VR,
        colorCamera,
        colorTransparent
    });
};

const bindXrButtons = ({ app, cameraEntity, colorCamera, colorTransparent }) => {
    const xr = app.xr;

    if (!xr || !xr.supported) {
        setXrMessage('WebXR is not supported on this platform.');
        return () => {};
    }

    const syncAvailability = () => {
        document
        .querySelector('.lctgs-xr-button[data-xr="immersive-ar"]')
        ?.classList.toggle('active', xr.isAvailable(pc.XRTYPE_AR));

        document
        .querySelector('.lctgs-xr-button[data-xr="immersive-vr"]')
        ?.classList.toggle('active', xr.isAvailable(pc.XRTYPE_VR));
    };

    syncAvailability();

    const onAvailable = (type, available) => {
        const el = document.querySelector(`.lctgs-xr-button[data-xr="${type}"]`);
        el?.classList.toggle('active', available);
    };

    const onSessionEnd = () => {
        cameraEntity.camera.clearColor = colorCamera;
    };

    const onClick = function () {
        if (!this.classList.contains('active')) {
            return;
        }

        const type = this.getAttribute('data-xr');
        startXrSession({
            app,
            cameraEntity,
            type,
            colorCamera,
            colorTransparent
        });
    };

    const buttons = document.querySelectorAll('.lctgs-xr-button');
    buttons.forEach(button => button.addEventListener('click', onClick));

    xr.on('available', onAvailable);
    xr.on('end', onSessionEnd);

    return () => {
        buttons.forEach(button => button.removeEventListener('click', onClick));
        xr.off('available', onAvailable);
        xr.off('end', onSessionEnd);
    };
};

export { injectXrUi, setXrMessage, bindXrButtons, startXrSession, toggleVrSession };
