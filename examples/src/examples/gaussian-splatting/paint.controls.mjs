/**
 * @param {import('../../app/components/Example.mjs').ControlOptions} options - The options.
 * @returns {JSX.Element} The returned JSX Element.
 */
export const controls = ({ observer, ReactPCUI, React, jsx, fragment }) => {
    const { BindingTwoWay, LabelGroup, ColorPicker, SelectInput, SliderInput, BooleanInput, Button, Panel } = ReactPCUI;

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
                    min: 0.0,
                    max: 1.0,
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
                        { v: 'high-contrast', t: 'Alto Contraste' },
                        { v: 'hsv', t: 'HSV' }
                    ]
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Paul Tol Scheme' },
                jsx(SelectInput, {
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'labelColorMapScheme' },
                    options: [
                        { v: 'bright', t: 'Bright' },
                        { v: 'vibrant', t: 'Vibrant' },
                        { v: 'muted', t: 'Muted' },
                        { v: 'sunset', t: 'Sunset' }
                    ]
                })
            ),
            jsx(Button, {
                text: 'Toggle Label Viewer (Alt+L)',
                onClick: () => {
                    observer.emit('toggleLabelViewer');
                }
            })
        ),
        jsx(
            Panel,
            { headerText: 'Asset Visibility' },
            jsx(
                LabelGroup,
                { text: 'Biker 1' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'showBiker1' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Biker 2' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'showBiker2' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Apartment' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'showApartment' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Sample Label' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'showSampleLabelOnly' }
                })
            )
        )
    );
};
