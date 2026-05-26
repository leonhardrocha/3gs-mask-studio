import { data } from 'examples/observer';

const initializeLctgsState = () => {
    data.set('paintColor', [1.0, 0.0, 0.0]);
    data.set('paintIntensity', 0.5);
    data.set('brushSize', 0.15);

    data.set('labelViewerEnabled', false);
    data.set('labelBlend', 0.8);
    data.set('labelColorMapMode', 'high-contrast');
    data.set('labelColorMapScheme', 'bright');

    data.set('assetVisibilityItems', []);
    data.set('newAssetUrl', '');

    data.set('xrMovementEnabled', true);
    data.set('xrPaintEnabled', false);
    data.set('handTrackingEnabled', true);
    data.set('controllerModelEnabled', true);
    data.set('xrRayVisible', true);
};

export { initializeLctgsState };
