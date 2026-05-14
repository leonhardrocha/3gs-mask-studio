// @config DESCRIPTION <span style="color:yellow"><b>Controls:</b> Right Mouse Button - paint | Left Mouse Button - orbit | Alt+L - toggle label viewer </span><br>3D painting on gaussian splats using GSplatProcessor.
import { data } from 'examples/observer';
import { deviceType, rootPath } from 'examples/utils';
import * as pc from 'playcanvas';

// Shader options for GSplatProcessor - paints splats inside brush sphere
const shaderOptions = {
    // GLSL process code - provides process() function with declarations
    processGLSL: `
        uniform vec4 uPaintSphere;
        uniform vec4 uPaintColor;

        void process() {
            vec3 center = getCenter();
            float dist = distance(center, uPaintSphere.xyz);
            if (dist < uPaintSphere.w) {
                // Inside brush - write paint color with intensity as alpha
                writeCustomColor(uPaintColor);
            } else {
                // Outside brush - output transparent (blender will keep existing)
                writeCustomColor(vec4(0.0));
            }
        }
    `,
    // WGSL process code
    processWGSL: `
        uniform uPaintSphere: vec4f;
        uniform uPaintColor: vec4f;

        fn process() {
            let center = getCenter();
            let dist = distance(center, uniform.uPaintSphere.xyz);
            if (dist < uniform.uPaintSphere.w) {
                writeCustomColor(uniform.uPaintColor);
            } else {
                writeCustomColor(vec4f(0.0));
            }
        }
    `
};

// Work buffer modifier - blends customColor paint texture with original splat color
const workBufferModifier = {
    glsl: `
        uniform float uLabelColoring;
        uniform float uLabelBlend;
        uniform float uLabelMax;
        uniform float uLabelSatBandSize;
        uniform float uLabelColorMapMode; // 0 = HSV, 1 = High Contrast
        uniform float uLabelColorScheme; // 0 = bright, 1 = vibrant, 2 = muted, 3 = sunset

        vec3 brightColor(int idx) {
            vec3 palette[7];
            palette[0] = vec3(0.2667, 0.4667, 0.6667); // #4477AA
            palette[1] = vec3(0.9333, 0.4000, 0.4667); // #EE6677
            palette[2] = vec3(0.1333, 0.5333, 0.2000); // #228833
            palette[3] = vec3(0.8000, 0.7333, 0.2667); // #CCBB44
            palette[4] = vec3(0.4000, 0.8000, 0.9333); // #66CCEE
            palette[5] = vec3(0.6667, 0.2000, 0.4667); // #AA3377
            palette[6] = vec3(0.7333, 0.7333, 0.7333); // #BBBBBB
            return palette[idx % 7];
        }

        vec3 vibrantColor(int idx) {
            vec3 palette[7];
            palette[0] = vec3(0.0000, 0.4667, 0.7333); // #0077BB
            palette[1] = vec3(0.2000, 0.7333, 0.9333); // #33BBEE
            palette[2] = vec3(0.0000, 0.6000, 0.5333); // #009988
            palette[3] = vec3(0.9333, 0.4667, 0.2000); // #EE7733
            palette[4] = vec3(0.8000, 0.2000, 0.0667); // #CC3311
            palette[5] = vec3(0.9333, 0.2000, 0.4667); // #EE3377
            palette[6] = vec3(0.7333, 0.7333, 0.7333); // #BBBBBB
            return palette[idx % 7];
        }

        vec3 mutedColor(int idx) {
            vec3 palette[9];
            palette[0] = vec3(0.2000, 0.1333, 0.5333); // #332288
            palette[1] = vec3(0.5333, 0.8000, 0.9333); // #88CCEE
            palette[2] = vec3(0.2667, 0.6667, 0.6000); // #44AA99
            palette[3] = vec3(0.0667, 0.4667, 0.2000); // #117733
            palette[4] = vec3(0.6000, 0.6000, 0.2000); // #999933
            palette[5] = vec3(0.8667, 0.8000, 0.4667); // #DDCC77
            palette[6] = vec3(0.8000, 0.4000, 0.4667); // #CC6677
            palette[7] = vec3(0.5333, 0.1333, 0.3333); // #882255
            palette[8] = vec3(0.6667, 0.2667, 0.6000); // #AA4499
            return palette[idx % 9];
        }

        vec3 sunsetColor(int idx) {
            vec3 palette[11];
            palette[0] = vec3(0.2118, 0.2941, 0.6275); // #364BA0
            palette[1] = vec3(0.2902, 0.4824, 0.7176); // #4A7BB7
            palette[2] = vec3(0.4314, 0.6314, 0.7922); // #6EA1CA
            palette[3] = vec3(0.5961, 0.7922, 0.8824); // #98CAE1
            palette[4] = vec3(0.7608, 0.8941, 0.9373); // #C2E4EF
            palette[5] = vec3(0.9176, 0.9255, 0.8000); // #EAECCC
            palette[6] = vec3(0.9961, 0.8549, 0.5451); // #FEDA8B
            palette[7] = vec3(0.9922, 0.7059, 0.3843); // #FDB462
            palette[8] = vec3(0.9569, 0.5137, 0.3020); // #F4834D
            palette[9] = vec3(0.8353, 0.2431, 0.3098); // #D53E4F
            palette[10] = vec3(0.6471, 0.0000, 0.1490); // #A50026
            return palette[idx % 11];
        }

        vec3 highContrastColor(int idx) {
            int scheme = int(floor(uLabelColorScheme + 0.5));
            if (scheme == 1) return vibrantColor(idx);
            if (scheme == 2) return mutedColor(idx);
            if (scheme == 3) return sunsetColor(idx);
            return brightColor(idx);
        }

        // Modify splat center position (no change)
        void modifySplatCenter(inout vec3 center) {
        }

        // Modify rotation/scale (no change)
        void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
        }

        // Modify color based on customColor
        void modifySplatColor(vec3 center, inout vec4 color) {
            // Read custom color using generated load function
            vec4 custom = loadCustomColor();
            if (custom.a > 0.0) {
                // Blend original color with custom color based on alpha (intensity)
                color.rgb = mix(color.rgb, custom.rgb, custom.a);
            }

            if (uLabelColoring > 0.5) {
                float label = texelFetch(splatLabel, splat.uv, 0).r * 255.0;
                if (label > 0.5) {
                    float safeMax = max(1.0, uLabelMax);
                    float safeBand = max(1.0, uLabelSatBandSize);
                    float hue = (label - 1.0) / safeMax;
                    float band = mod(floor((label - 1.0) / safeBand), 2.0);
                    float sat = mix(0.25, 1.0, band);
                    vec3 labelColor;
                    if (uLabelColorMapMode > 0.5) {
                        labelColor = highContrastColor(int(label - 1.0));
                    } else {
                        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                        vec3 p = abs(fract(vec3(hue) + K.xyz) * 6.0 - K.www);
                        labelColor = mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), sat);
                    }
                    color.rgb = mix(color.rgb, labelColor, clamp(uLabelBlend, 0.0, 1.0));
                }
            }
        }
    `,
    wgsl: `
        uniform uLabelColoring: f32;
        uniform uLabelBlend: f32;
        uniform uLabelMax: f32;
        uniform uLabelSatBandSize: f32;
        uniform uLabelColorMapMode: f32;
        uniform uLabelColorScheme: f32;

        fn brightColor(idx: i32) -> vec3f {
            let i = idx % 7;
            if (i == 0) { return vec3f(0.2667, 0.4667, 0.6667); }
            if (i == 1) { return vec3f(0.9333, 0.4000, 0.4667); }
            if (i == 2) { return vec3f(0.1333, 0.5333, 0.2000); }
            if (i == 3) { return vec3f(0.8000, 0.7333, 0.2667); }
            if (i == 4) { return vec3f(0.4000, 0.8000, 0.9333); }
            if (i == 5) { return vec3f(0.6667, 0.2000, 0.4667); }
            return vec3f(0.7333, 0.7333, 0.7333);
        }

        fn vibrantColor(idx: i32) -> vec3f {
            let i = idx % 7;
            if (i == 0) { return vec3f(0.0000, 0.4667, 0.7333); }
            if (i == 1) { return vec3f(0.2000, 0.7333, 0.9333); }
            if (i == 2) { return vec3f(0.0000, 0.6000, 0.5333); }
            if (i == 3) { return vec3f(0.9333, 0.4667, 0.2000); }
            if (i == 4) { return vec3f(0.8000, 0.2000, 0.0667); }
            if (i == 5) { return vec3f(0.9333, 0.2000, 0.4667); }
            return vec3f(0.7333, 0.7333, 0.7333);
        }

        fn mutedColor(idx: i32) -> vec3f {
            let i = idx % 9;
            if (i == 0) { return vec3f(0.2000, 0.1333, 0.5333); }
            if (i == 1) { return vec3f(0.5333, 0.8000, 0.9333); }
            if (i == 2) { return vec3f(0.2667, 0.6667, 0.6000); }
            if (i == 3) { return vec3f(0.0667, 0.4667, 0.2000); }
            if (i == 4) { return vec3f(0.6000, 0.6000, 0.2000); }
            if (i == 5) { return vec3f(0.8667, 0.8000, 0.4667); }
            if (i == 6) { return vec3f(0.8000, 0.4000, 0.4667); }
            if (i == 7) { return vec3f(0.5333, 0.1333, 0.3333); }
            return vec3f(0.6667, 0.2667, 0.6000);
        }

        fn sunsetColor(idx: i32) -> vec3f {
            let i = idx % 11;
            if (i == 0) { return vec3f(0.2118, 0.2941, 0.6275); }
            if (i == 1) { return vec3f(0.2902, 0.4824, 0.7176); }
            if (i == 2) { return vec3f(0.4314, 0.6314, 0.7922); }
            if (i == 3) { return vec3f(0.5961, 0.7922, 0.8824); }
            if (i == 4) { return vec3f(0.7608, 0.8941, 0.9373); }
            if (i == 5) { return vec3f(0.9176, 0.9255, 0.8000); }
            if (i == 6) { return vec3f(0.9961, 0.8549, 0.5451); }
            if (i == 7) { return vec3f(0.9922, 0.7059, 0.3843); }
            if (i == 8) { return vec3f(0.9569, 0.5137, 0.3020); }
            if (i == 9) { return vec3f(0.8353, 0.2431, 0.3098); }
            return vec3f(0.6471, 0.0000, 0.1490);
        }

        fn highContrastColor(idx: i32) -> vec3f {
            let scheme = i32(floor(uniform.uLabelColorScheme + 0.5));
            if (scheme == 1) { return vibrantColor(idx); }
            if (scheme == 2) { return mutedColor(idx); }
            if (scheme == 3) { return sunsetColor(idx); }
            return brightColor(idx);
        }

        // Modify splat center position (no change)
        fn modifySplatCenter(center: ptr<function, vec3f>) {
        }

        // Modify rotation/scale (no change)
        fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
        }

        // Modify color based on customColor
        fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
            // Read custom color using generated load function
            let custom = loadCustomColor();
            if (custom.a > 0.0) {
                // Blend original color with custom color based on alpha (intensity)
                (*color).r = mix((*color).r, custom.r, custom.a);
                (*color).g = mix((*color).g, custom.g, custom.a);
                (*color).b = mix((*color).b, custom.b, custom.a);
            }

            if (uniform.uLabelColoring > 0.5) {
                let label = textureLoad(splatLabel, splat.uv, 0).r * 255.0;
                if (label > 0.5) {
                    let safeMax = max(1.0, uniform.uLabelMax);
                    let safeBand = max(1.0, uniform.uLabelSatBandSize);
                    let hue = (label - 1.0) / safeMax;
                    let band = f32(i32(floor((label - 1.0) / safeBand)) % 2);
                    let sat = mix(0.25, 1.0, band);
                    var labelColor: vec3f;
                    if (uniform.uLabelColorMapMode > 0.5) {
                        labelColor = highContrastColor(i32(label - 1.0));
                    } else {
                        let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                        let p = abs(fract(vec3f(hue) + k.xyz) * 6.0 - k.www);
                        labelColor = mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), vec3f(sat));
                    }
                    (*color).rgb = mix((*color).rgb, labelColor, clamp(uniform.uLabelBlend, 0.0, 1.0));
                }
            }
        }
    `
};

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('application-canvas'));
window.focus();

const gfxOptions = {
    deviceTypes: [deviceType],
    // disable antialiasing as gaussian splats do not benefit from it and it's expensive
    antialias: false
};

const device = await pc.createGraphicsDevice(canvas, gfxOptions);
device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

const createOptions = new pc.AppOptions();
createOptions.graphicsDevice = device;
createOptions.mouse = new pc.Mouse(document.body);
createOptions.touch = new pc.TouchDevice(document.body);

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

// Set the canvas to fill the window and automatically change resolution to be the same as the canvas size
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

// Ensure canvas is resized when window changes size
const resize = () => app.resizeCanvas();
window.addEventListener('resize', resize);
app.on('destroy', () => {
    window.removeEventListener('resize', resize);
});

// Initialize control data with defaults
data.set('paintColor', [1.0, 0.0, 0.0]); // Red
data.set('paintIntensity', 0.5);
data.set('brushSize', 0.15);
data.set('labelViewerEnabled', false);
data.set('labelBlend', 0.8);
data.set('labelColorMapMode', 'high-contrast');
data.set('labelColorMapScheme', 'bright');
data.set('showBiker1', true);
data.set('showBiker2', true);
data.set('showApartment', true);
data.set('showSampleLabelOnly', true);

const assets = {
    orbit: new pc.Asset('script', 'script', { url: `${rootPath}/static/scripts/camera/orbit-camera.js` }),
    biker: new pc.Asset('biker', 'gsplat', { url: `${rootPath}/static/assets/splats/biker.compressed.ply` }),
    apartment: new pc.Asset('apartment', 'gsplat', { url: `${rootPath}/static/assets/splats/apartment.sog` }),
    sampleLabelOnlyCompact: new pc.Asset('sample_label_only_compact', 'gsplat', { url: `${rootPath}/static/assets/splats/sample_label_only_compact.ply` })
};

const assetListLoader = new pc.AssetListLoader(Object.values(assets), app.assets);
assetListLoader.load(() => {
    app.start();

    data.on('renderer:set', () => {
        app.scene.gsplat.renderer = data.get('renderer');
        const current = app.scene.gsplat.currentRenderer;
        if (current !== data.get('renderer')) {
            setTimeout(() => data.set('renderer', current), 0);
        }
    });
    data.set('renderer', pc.GSPLAT_RENDERER_AUTO);

    // Store all paintable entities
    const paintables = [];

    const applyLabelViewerParameters = (gsplatComponent, maxLabel = 1) => {
        gsplatComponent.setParameter('uLabelColoring', data.get('labelViewerEnabled') ? 1 : 0);
        gsplatComponent.setParameter('uLabelBlend', data.get('labelBlend'));
        gsplatComponent.setParameter('uLabelMax', Math.max(1, maxLabel));
        gsplatComponent.setParameter('uLabelSatBandSize', 16);
        gsplatComponent.setParameter('uLabelColorMapMode', data.get('labelColorMapMode') === 'high-contrast' ? 1 : 0);
        const scheme = data.get('labelColorMapScheme');
        const schemeValue = scheme === 'vibrant' ? 1 : scheme === 'muted' ? 2 : scheme === 'sunset' ? 3 : 0;
        gsplatComponent.setParameter('uLabelColorScheme', schemeValue);
    };

    const initializeLabelTextureFromPly = (gsplatComponent, resource) => {
        const labelTexture = gsplatComponent.getInstanceTexture('splatLabel');
        if (!labelTexture) {
            return 1;
        }

        const labelData = labelTexture.lock();
        labelData.fill(0);

        let maxLabel = 1;
        const rawLabels = resource?.gsplatData?.getProp?.('label');
        if (rawLabels?.length) {
            const n = Math.min(rawLabels.length, labelData.length);
            for (let i = 0; i < n; i++) {
                const value = Math.max(0, Math.floor(Number(rawLabels[i])));
                maxLabel = Math.max(maxLabel, value);
                labelData[i] = Math.min(255, value);
            }
        }

        labelTexture.unlock();
        return maxLabel;
    };

    // Creates a paintable gsplat entity with position, rotation, scale, and sets up processing
    const createPaintableSplat = (name, asset, position, rotation, scale) => {
        const entity = new pc.Entity(name);
        const gsplatComponent = entity.addComponent('gsplat', { asset, unified: true });
        entity.setLocalPosition(...position);
        entity.setLocalEulerAngles(...rotation);
        entity.setLocalScale(...scale);
        app.root.addChild(entity);

        // Add customColor stream if not already present on the resource
        const resource = /** @type {pc.GSplatResource} */ (asset.resource);
        const extraStreams = [];
        if (!resource.format.getStream('customColor')) {
            extraStreams.push({ name: 'customColor', format: pc.PIXELFORMAT_RGBA8, storage: pc.GSPLAT_STREAM_INSTANCE });
        }
        if (!resource.format.getStream('splatLabel')) {
            extraStreams.push({ name: 'splatLabel', format: pc.PIXELFORMAT_R8, storage: pc.GSPLAT_STREAM_INSTANCE });
        }
        if (extraStreams.length > 0) {
            resource.format.addExtraStreams(extraStreams);
        }

        // Create processor for this entity's instance texture
        // This processor will read from the default stream and write to the customColor stream. It will
        // use brush sphere to determine which splats to colorize.
        const processor = new pc.GSplatProcessor(
            device,
            { component: gsplatComponent },
            { component: gsplatComponent, streams: ['customColor'] },
            shaderOptions
        );

        // Zero-initialize the customColor texture (alpha=0 means not modified)
        const customColorTexture = gsplatComponent.getInstanceTexture('customColor');
        const texData = customColorTexture.lock();
        texData.fill(0);
        customColorTexture.unlock();

        // Use alpha blending: new color replaces old based on intensity (alpha)

        processor.blendState = pc.BlendState.ALPHABLEND;

        // Set up workBufferModifier to read customColor and blend with original
        // This modification is used when the gsplat data are written to the global workbuffer, and
        // we want to blend the customColor with the original color.
        gsplatComponent.setWorkBufferModifier(workBufferModifier);
        gsplatComponent.workBufferUpdate = pc.WORKBUFFER_UPDATE_ALWAYS;

        const maxLabel = initializeLabelTextureFromPly(gsplatComponent, resource);
        applyLabelViewerParameters(gsplatComponent, maxLabel);

        paintables.push({ entity, processor, gsplatComponent, maxLabel });
        return entity;
    };

    // Create paintable splats
    createPaintableSplat('biker1', assets.biker, [-1.9, -0.55, 0.6], [180, -90, 0], [0.3, 0.3, 0.3]);
    createPaintableSplat('biker2', assets.biker, [-3, -0.5, -0.5], [180, 180, 0], [0.3, 0.3, 0.3]);
    createPaintableSplat('apartment', assets.apartment, [0, -0.5, -3], [180, 0, 0], [0.5, 0.5, 0.5]);
    createPaintableSplat('sample-label-only', assets.sampleLabelOnlyCompact, [1.2, -0.5, -1.3], [180, 0, 0], [0.4, 0.4, 0.4]);

    const visibilityPathByName = {
        biker1: 'showBiker1',
        biker2: 'showBiker2',
        apartment: 'showApartment',
        'sample-label-only': 'showSampleLabelOnly'
    };

    const syncAssetVisibility = () => {
        for (const paintable of paintables) {
            const path = visibilityPathByName[paintable.entity.name];
            if (path) {
                paintable.entity.enabled = !!data.get(path);
            }
        }
    };

    syncAssetVisibility();

    // Camera positions
    const cameraPos = new pc.Vec3(-0.98, 0.28, -2.31);
    const focusPos = new pc.Vec3(-1.10, 0.13, -1.56);

    // Create camera with orbit camera script
    const camera = new pc.Entity('Camera');
    camera.addComponent('camera', {
        fov: 90,
        clearColor: new pc.Color(0, 0, 0),
        toneMapping: pc.TONEMAP_LINEAR
    });
    camera.setLocalPosition(cameraPos);
    camera.lookAt(focusPos);
    app.root.addChild(camera);

    // Add orbit camera script with native mouse input (LMB orbit, MMB pan, wheel zoom)
    camera.addComponent('script');
    const orbitCamera = camera.script.create('orbitCamera', {
        attributes: {
            frameOnStart: false,
            inertiaFactor: 0.07
        }
    });
    const orbitInput = camera.script.create('orbitCameraInputMouse');

    // Initialize orbit camera to match current camera position and focus
    orbitCamera.resetAndLookAtPoint(cameraPos, focusPos);

    // Paint state
    let isPainting = false;

    // Track if picker needs re-preparation (after camera moves)
    let pickerDirty = true;

    // Disable context menu for RMB
    app.mouse.disableContextMenu();

    // Helper to update paint color on all processors
    const updatePaintColor = () => {
        const color = data.get('paintColor');
        const intensity = data.get('paintIntensity');
        // RGB from color picker, alpha is the intensity
        for (const paintable of paintables) {
            paintable.processor.setParameter('uPaintColor', [color[0], color[1], color[2], intensity]);
        }
    };

    // Set initial paint color
    updatePaintColor();

    // Listen for color/intensity changes
    data.on('paintColor:set', updatePaintColor);
    data.on('paintIntensity:set', updatePaintColor);

    const syncLabelViewer = () => {
        for (const paintable of paintables) {
            applyLabelViewerParameters(paintable.gsplatComponent, paintable.maxLabel);
        }
    };

    data.on('labelViewerEnabled:set', syncLabelViewer);
    data.on('labelBlend:set', syncLabelViewer);
    data.on('labelColorMapMode:set', syncLabelViewer);
    data.on('labelColorMapScheme:set', syncLabelViewer);
    data.on('toggleLabelViewer', () => {
        data.set('labelViewerEnabled', !data.get('labelViewerEnabled'));
    });
    data.on('showBiker1:set', syncAssetVisibility);
    data.on('showBiker2:set', syncAssetVisibility);
    data.on('showApartment:set', syncAssetVisibility);
    data.on('showSampleLabelOnly:set', syncAssetVisibility);

    const onKeyDown = (event) => {
        if (event.altKey && event.key.toLowerCase() === 'l') {
            event.preventDefault();
            data.set('labelViewerEnabled', !data.get('labelViewerEnabled'));
        }
    };
    window.addEventListener('keydown', onKeyDown);

    // Create picker for world position (with depth enabled)
    const picker = new pc.Picker(app, 1, 1, true);
    const worldLayer = app.scene.layers.getLayerByName('World');

    // Prepare picker (re-prepare when camera moves)
    const preparePicker = () => {
        if (pickerDirty) {
            picker.resize(canvas.clientWidth, canvas.clientHeight);
            picker.prepare(camera.camera, app.scene, [worldLayer]);
            pickerDirty = false;
        }
    };

    // Pending paint requests - processed in update loop for consistent frame timing
    const pendingPaints = [];

    // Temp vectors for coordinate transformation
    const invMat = new pc.Mat4();
    const modelPoint = new pc.Vec3();

    // Process pending paint requests in update loop
    app.on('update', () => {
        // Process all pending paint requests
        while (pendingPaints.length > 0) {
            const { worldPoint, brushRadius } = pendingPaints.shift();

            // Run all processors - each transforms to its own model space
            for (const paintable of paintables) {
                // Transform world position to this entity's model space
                invMat.copy(paintable.entity.getWorldTransform()).invert();
                invMat.transformPoint(worldPoint, modelPoint);

                // Set paint sphere uniform and run processor
                paintable.processor.setParameter('uPaintSphere', [modelPoint.x, modelPoint.y, modelPoint.z, brushRadius]);
                paintable.processor.process();

                // Trigger work buffer update for next frame to reflect the paint changes
                paintable.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
            }
        }
    });

    // Request paint at a specific screen position - queues for processing in update loop
    const paintAt = (x, y) => {
        // Prepare picker if needed (after camera moved)
        preparePicker();

        // Get world position for the paint brush
        picker.getWorldPointAsync(x, y).then((worldPoint) => {
            if (worldPoint) {
                const brushRadius = data.get('brushSize');

                // Queue paint request for processing in update loop
                pendingPaints.push({ worldPoint: worldPoint.clone(), brushRadius });
            }
        });
    };

    // RMB paint - disable orbit input while painting (orbit-camera handles LMB/MMB/wheel natively)
    app.mouse.on(pc.EVENT_MOUSEDOWN, (e) => {
        if (e.button === pc.MOUSEBUTTON_RIGHT) {
            isPainting = true;
            pickerDirty = true;
            orbitInput.enabled = false;
            orbitInput.panButtonDown = false; // Cancel pan that orbit-camera started
            paintAt(e.x, e.y);
        }
    });

    app.mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
        if (isPainting) paintAt(e.x, e.y);
    });

    app.mouse.on(pc.EVENT_MOUSEUP, (e) => {
        if (e.button === pc.MOUSEBUTTON_RIGHT) {
            isPainting = false;
            orbitInput.enabled = true;
        }
    });

    window.addEventListener('mouseup', () => {
        isPainting = false;
        orbitInput.enabled = true;
    });

    // Cleanup on destroy
    app.on('destroy', () => {
        for (const paintable of paintables) {
            paintable.processor?.destroy();
        }
        picker.destroy();
        window.removeEventListener('keydown', onKeyDown);
    });
});

export { app };
