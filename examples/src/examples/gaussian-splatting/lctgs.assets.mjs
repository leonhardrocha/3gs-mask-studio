import { rootPath } from 'examples/utils';

const createLctgsAssets = () => {
    return {
        orbit: new pc.Asset('script', 'script', { url: `${rootPath}/static/scripts/camera/orbit-camera.js` }),
        biker: new pc.Asset('biker', 'gsplat', { url: `${rootPath}/static/assets/splats/biker.compressed.ply` }),
        apartment: new pc.Asset('apartment', 'gsplat', { url: `${rootPath}/static/assets/splats/apartment.sog` }),
        sampleLabelOnlyCompact: new pc.Asset('sample_label_only_compact', 'gsplat', { url: `${rootPath}/static/assets/splats/sample_label_only_compact.ply` }),
        controllerGlb: new pc.Asset('vr-controller-glb', 'container', { url: `${rootPath}/static/assets/models/vr-controller.glb` })
    };
};

const loadAssets = (app, assets) => {
    return new Promise((resolve) => {
        const loader = new pc.AssetListLoader(Object.values(assets), app.assets);
        loader.load(() => resolve());
    });
};

export { createLctgsAssets, loadAssets };
