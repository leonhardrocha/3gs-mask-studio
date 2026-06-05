import * as pc from 'playcanvas';

import { SELECT_ADDITIVE, SELECT_SUBTRACTIVE } from './selection-system.mjs';

/**
 * Desktop brush input: right mouse button selects with surface snapping.
 *
 * Surface snap reuses `pc.Picker` depth (same approach as the paint example):
 * the picker renders the World layer from the main camera and `getWorldPointAsync`
 * returns the 3D point on the splat surface under the cursor. The brush sphere is
 * queued at that point.
 *
 * Mode: `data.selectionMode` ('additive' | 'subtractive'); holding Shift flips it.
 * Left mouse / wheel / middle keep orbiting natively (orbit-camera script).
 *
 * Note: `getWorldPointAsync` is WebGL-only. On WebGPU this path is disabled (a
 * fixed-distance fallback can be added in a later phase).
 */
export function createDesktopBrushInput({ app, canvas, camera, orbitInput, system, data }) {
    const picker = new pc.Picker(app, 1, 1, true);
    const worldLayer = app.scene.layers.getLayerByName('World');

    let isSelecting = false;
    let pickerDirty = true;

    app.mouse.disableContextMenu();

    const preparePicker = () => {
        if (pickerDirty) {
            picker.resize(canvas.clientWidth, canvas.clientHeight);
            picker.prepare(camera.camera, app.scene, [worldLayer]);
            pickerDirty = false;
        }
    };

    const modeFrom = (e) => {
        const subtractive = data.get('selectionMode') === 'subtractive';
        const flip = !!e.shiftKey;
        return (subtractive !== flip) ? SELECT_SUBTRACTIVE : SELECT_ADDITIVE;
    };

    const selectAt = (x, y, mode) => {
        preparePicker();
        picker.getWorldPointAsync(x, y).then((worldPoint) => {
            if (worldPoint) {
                system.queueSelect(worldPoint, data.get('brushSize'), mode);
            }
        });
    };

    const onMouseDown = (e) => {
        if (e.button === pc.MOUSEBUTTON_RIGHT) {
            isSelecting = true;
            pickerDirty = true;
            if (orbitInput) {
                orbitInput.enabled = false;
                orbitInput.panButtonDown = false; // cancel pan orbit-camera started
            }
            selectAt(e.x, e.y, modeFrom(e));
        }
    };

    const onMouseMove = (e) => {
        if (isSelecting) selectAt(e.x, e.y, modeFrom(e));
    };

    const stop = () => {
        isSelecting = false;
        if (orbitInput) orbitInput.enabled = true;
    };

    const onMouseUp = (e) => {
        if (e.button === pc.MOUSEBUTTON_RIGHT) stop();
    };

    app.mouse.on(pc.EVENT_MOUSEDOWN, onMouseDown);
    app.mouse.on(pc.EVENT_MOUSEMOVE, onMouseMove);
    app.mouse.on(pc.EVENT_MOUSEUP, onMouseUp);
    window.addEventListener('mouseup', stop);

    const destroy = () => {
        app.mouse.off(pc.EVENT_MOUSEDOWN, onMouseDown);
        app.mouse.off(pc.EVENT_MOUSEMOVE, onMouseMove);
        app.mouse.off(pc.EVENT_MOUSEUP, onMouseUp);
        window.removeEventListener('mouseup', stop);
        picker.destroy();
    };

    return {
        destroy,
        markPickerDirty: () => { pickerDirty = true; }
    };
}
