/**
 * @param {import('../../../app/components/Example.mjs').ControlOptions} options - The options.
 * @returns {*} The returned controls tree.
 */
export const controls = ({ observer, ReactPCUI, React, jsx, fragment }) => {
    const { BindingTwoWay, LabelGroup, ColorPicker, SelectInput, SliderInput, BooleanInput, Button, Panel } = ReactPCUI;

    const AssetVisibilityPanel = () => {
        const [items, setItems] = React.useState(observer.get('assetVisibilityItems') ?? []);

        React.useEffect(() => {
            const onItemsSet = () => {
                setItems(observer.get('assetVisibilityItems') ?? []);
            };

            observer.on('assetVisibilityItems:set', onItemsSet);
            onItemsSet();
        }, []);

        const rows = [];
        for (const item of items) {
            rows.push(jsx(
                LabelGroup,
                { text: item.label, key: item.path },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: item.path }
                })
            ));
        }

        if (rows.length === 0) {
            rows.push(jsx('div', { key: 'empty' }, 'No assets loaded'));
        }

        return jsx(Panel, { headerText: 'Asset Visibility' }, ...rows);
    };

    return fragment(
        jsx(
            Panel,
            { headerText: 'Renderer' },
            jsx(
                LabelGroup,
                { text: 'Renderer' },
                jsx(SelectInput, {
                    type: 'number',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'renderer' },
                    value: observer.get('renderer') ?? 0,
                    options: [
                        { v: 0, t: 'Auto' },
                        { v: 1, t: 'Raster (CPU Sort)' },
                        { v: 2, t: 'Raster (GPU Sort)' },
                        { v: 3, t: 'Compute' }
                    ]
                })
            )
        ),
        jsx(
            Panel,
            { headerText: 'Paint Settings' },
            jsx(
                LabelGroup,
                { text: 'Paint Color' },
                jsx(ColorPicker, {
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'paintColor' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Intensity' },
                jsx(SliderInput, {
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'paintIntensity' },
                    min: 0.1,
                    max: 1.0,
                    precision: 2
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Brush Size' },
                jsx(SliderInput, {
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'brushSize' },
                    min: 0.05,
                    max: 0.5,
                    precision: 2
                })
            )
        ),
        jsx(
            Panel,
            { headerText: 'Label Viewer' },
            jsx(
                LabelGroup,
                { text: 'Enabled' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'labelViewerEnabled' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Blend' },
                jsx(SliderInput, {
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'labelBlend' },
                    min: 0,
                    max: 1,
                    precision: 2
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Color Map' },
                jsx(SelectInput, {
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'labelColorMapMode' },
                    options: [
                        { v: 'high-contrast', t: 'High Contrast' },
                        { v: 'hsv', t: 'HSV' }
                    ]
                })
            ),
            jsx(Button, {
                text: 'Toggle Label Viewer (Alt+L)',
                onClick: () => observer.emit('toggleLabelViewer')
            })
        ),
        jsx(
            Panel,
            { headerText: 'XR Settings' },
            jsx(
                LabelGroup,
                { text: 'Movement' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'xrMovementEnabled' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Paint in XR' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'xrPaintEnabled' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Hand Tracking' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'handTrackingEnabled' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Controller GLB' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'controllerModelEnabled' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Pointer Rays' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'xrRayVisible' }
                })
            )
        ),
        jsx(AssetVisibilityPanel, {}),
        jsx(
            Panel,
            { headerText: 'Dynamic Asset Management' },
            jsx('div', {},
                jsx('input', {
                    type: 'text',
                    placeholder: 'Asset URL',
                    onChange: (e) => observer.set('newAssetUrl', e.target.value)
                }),
                jsx(Button, {
                    text: 'Add',
                    onClick: () => observer.emit('addAsset', observer.get('newAssetUrl'))
                })
            )
        )
    );
};
