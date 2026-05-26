const shaderOptions = {
    processGLSL: `
        uniform vec4 uPaintSphere;
        uniform vec4 uPaintColor;

        void process() {
            vec3 center = getCenter();
            float dist = distance(center, uPaintSphere.xyz);
            if (dist < uPaintSphere.w) {
                writeCustomColor(uPaintColor);
            } else {
                writeCustomColor(vec4(0.0));
            }
        }
    `,
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

const workBufferModifier = {
    glsl: `
        uniform float uLabelColoring;
        uniform float uLabelBlend;
        uniform float uLabelMax;
        uniform float uLabelColorMapMode;

        vec3 brightColor(int idx) {
            vec3 palette[7];
            palette[0] = vec3(0.2667, 0.4667, 0.6667);
            palette[1] = vec3(0.9333, 0.4000, 0.4667);
            palette[2] = vec3(0.1333, 0.5333, 0.2000);
            palette[3] = vec3(0.8000, 0.7333, 0.2667);
            palette[4] = vec3(0.4000, 0.8000, 0.9333);
            palette[5] = vec3(0.6667, 0.2000, 0.4667);
            palette[6] = vec3(0.7333, 0.7333, 0.7333);
            return palette[idx % 7];
        }

        void modifySplatCenter(inout vec3 center) {
        }

        void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
        }

        void modifySplatColor(vec3 center, inout vec4 color) {
            vec4 custom = loadCustomColor();
            if (custom.a > 0.0) {
                color.rgb = mix(color.rgb, custom.rgb, custom.a);
            }

            if (uLabelColoring > 0.5) {
                float label = texelFetch(splatLabel, splat.uv, 0).r * 255.0;
                if (label > 0.5) {
                    float hue = (label - 1.0) / max(1.0, uLabelMax);
                    vec3 labelColor;
                    if (uLabelColorMapMode > 0.5) {
                        labelColor = brightColor(int(label - 1.0));
                    } else {
                        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                        vec3 p = abs(fract(vec3(hue) + K.xyz) * 6.0 - K.www);
                        labelColor = mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), 1.0);
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
        uniform uLabelColorMapMode: f32;

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

        fn modifySplatCenter(center: ptr<function, vec3f>) {
        }

        fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
        }

        fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
            let custom = loadCustomColor();
            if (custom.a > 0.0) {
                (*color).rgb = mix((*color).rgb, custom.rgb, custom.a);
            }

            if (uniform.uLabelColoring > 0.5) {
                let label = textureLoad(splatLabel, splat.uv, 0).r * 255.0;
                if (label > 0.5) {
                    let hue = (label - 1.0) / max(1.0, uniform.uLabelMax);
                    var labelColor: vec3f;
                    if (uniform.uLabelColorMapMode > 0.5) {
                        labelColor = brightColor(i32(label - 1.0));
                    } else {
                        let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                        let p = abs(fract(vec3f(hue) + k.xyz) * 6.0 - k.www);
                        labelColor = mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), vec3f(1.0));
                    }
                    (*color).rgb = mix((*color).rgb, labelColor, clamp(uniform.uLabelBlend, 0.0, 1.0));
                }
            }
        }
    `
};

const createPaintSystem = ({ app, device, data }) => {
    const paintables = [];
    const visibilityPathByName = {};
    const visibilityListenerPaths = new Set();

    const syncAssetVisibility = () => {
        for (const paintable of paintables) {
            const path = visibilityPathByName[paintable.entity.name];
            if (path) {
                paintable.entity.enabled = !!data.get(path);
            }
        }
    };

    const registerVisibilityItem = (entityName, label) => {
        if (visibilityPathByName[entityName]) {
            return;
        }

        const safeName = entityName.replace(/\W/g, '_');
        const path = `showAsset_${safeName}`;
        visibilityPathByName[entityName] = path;

        data.set(path, true);

        const currentItems = data.get('assetVisibilityItems') ?? [];
        data.set('assetVisibilityItems', currentItems.concat({
            name: entityName,
            label,
            path
        }));

        if (!visibilityListenerPaths.has(path)) {
            visibilityListenerPaths.add(path);
            data.on(`${path}:set`, syncAssetVisibility);
        }
    };

    const applyLabelViewerParameters = (gsplatComponent, maxLabel = 1) => {
        gsplatComponent.setParameter('uLabelColoring', data.get('labelViewerEnabled') ? 1 : 0);
        gsplatComponent.setParameter('uLabelBlend', data.get('labelBlend'));
        gsplatComponent.setParameter('uLabelMax', Math.max(1, maxLabel));
        gsplatComponent.setParameter('uLabelColorMapMode', data.get('labelColorMapMode') === 'high-contrast' ? 1 : 0);
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

    const createPaintableSplat = (name, asset, position, rotation, scale) => {
        const entity = new pc.Entity(name);
        const gsplatComponent = entity.addComponent('gsplat', { asset, unified: true });
        entity.setLocalPosition(...position);
        entity.setLocalEulerAngles(...rotation);
        entity.setLocalScale(...scale);
        app.root.addChild(entity);

        const resource = asset.resource;
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

        const processor = new pc.GSplatProcessor(
            device,
            { component: gsplatComponent },
            { component: gsplatComponent, streams: ['customColor'] },
            shaderOptions
        );
        processor.blendState = pc.BlendState.ALPHABLEND;

        const customColorTexture = gsplatComponent.getInstanceTexture('customColor');
        const texData = customColorTexture.lock();
        texData.fill(0);
        customColorTexture.unlock();

        gsplatComponent.setWorkBufferModifier(workBufferModifier);
        gsplatComponent.workBufferUpdate = pc.WORKBUFFER_UPDATE_ALWAYS;

        const maxLabel = initializeLabelTextureFromPly(gsplatComponent, resource);
        applyLabelViewerParameters(gsplatComponent, maxLabel);

        paintables.push({ entity, processor, gsplatComponent, maxLabel });
        return entity;
    };

    const updatePaintColor = () => {
        const color = data.get('paintColor');
        const intensity = data.get('paintIntensity');
        for (const paintable of paintables) {
            paintable.processor.setParameter('uPaintColor', [color[0], color[1], color[2], intensity]);
        }
    };

    const syncLabelViewer = () => {
        for (const paintable of paintables) {
            applyLabelViewerParameters(paintable.gsplatComponent, paintable.maxLabel);
        }
    };

    const pendingPaints = [];
    const invMat = new pc.Mat4();
    const modelPoint = new pc.Vec3();

    const queuePaintPoint = (worldPoint, brushRadius) => {
        pendingPaints.push({ worldPoint: worldPoint.clone(), brushRadius });
    };

    const processPendingPaints = () => {
        while (pendingPaints.length > 0) {
            const { worldPoint, brushRadius } = pendingPaints.shift();

            for (const paintable of paintables) {
                invMat.copy(paintable.entity.getWorldTransform()).invert();
                invMat.transformPoint(worldPoint, modelPoint);

                paintable.processor.setParameter('uPaintSphere', [modelPoint.x, modelPoint.y, modelPoint.z, brushRadius]);
                paintable.processor.process();
                paintable.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
            }
        }
    };

    const destroy = () => {
        for (const paintable of paintables) {
            paintable.processor?.destroy();
        }
    };

    return {
        paintables,
        registerVisibilityItem,
        syncAssetVisibility,
        createPaintableSplat,
        updatePaintColor,
        syncLabelViewer,
        queuePaintPoint,
        processPendingPaints,
        destroy
    };
};

export { createPaintSystem };
