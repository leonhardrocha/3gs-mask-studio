/**
 * Work buffer modifier for the GSplat editor example.
 * This shader modifies splat appearance during rendering:
 * - Deleted splats (visible=0) are hidden by setting scale to zero
 * - Selected splats (selection>0.5) are tinted yellow for visual feedback
 */
export const workBufferModifier = {
    glsl: /* glsl */ `
        uniform float uLabelColoring;
        uniform float uLabelBlend;
        uniform float uLabelMax;
        uniform float uLabelSatBandSize;

        void modifySplatCenter(inout vec3 center) {
        }

        void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
            float visible = texelFetch(splatVisible, splat.uv, 0).r;
            if (visible < 0.5) {
                scale = vec3(0.0);  // Deleted - make invisible
            }
        }

        void modifySplatColor(vec3 center, inout vec4 color) {
            float selected = texelFetch(splatSelection, splat.uv, 0).r;
            if (selected > 0.5) {
                color.rgb = mix(color.rgb, vec3(1.0, 1.0, 0.0), 0.7);  // Yellow tint for selected
            }

            // HSV label colorization
            if (uLabelColoring > 0.5) {
                float label = texelFetch(splatLabel, splat.uv, 0).r * 255.0;
                if (label > 0.5) {
                    float safeMax = max(1.0, uLabelMax);
                    float hue = (label - 1.0) / safeMax;
                    float bandSize = max(1.0, uLabelSatBandSize);
                    float band = mod(floor((label - 1.0) / bandSize), 2.0);
                    float sat = mix(0.25, 1.0, band);
                    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                    vec3 p = abs(fract(vec3(hue) + K.xyz) * 6.0 - K.www);
                    vec3 labelColor = mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), sat);
                    color.rgb = mix(color.rgb, labelColor, clamp(uLabelBlend, 0.0, 1.0));
                }
            }
        }
    `,
    wgsl: /* wgsl */ `
        uniform uLabelColoring: f32;
        uniform uLabelBlend: f32;
        uniform uLabelMax: f32;
        uniform uLabelSatBandSize: f32;

        fn modifySplatCenter(center: ptr<function, vec3f>) {
        }

        fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
            let visible = textureLoad(splatVisible, splat.uv, 0).r;
            if (visible < 0.5) {
                *scale = vec3f(0.0);  // Deleted - make invisible
            }
        }

        fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
            let selected = textureLoad(splatSelection, splat.uv, 0).r;
            if (selected > 0.5) {
                (*color).r = mix((*color).r, 1.0, 0.7);  // Yellow tint for selected
                (*color).g = mix((*color).g, 1.0, 0.7);
                (*color).b = mix((*color).b, 0.0, 0.7);
            }

            // HSV label colorization
            if (uniform.uLabelColoring > 0.5) {
                let label = textureLoad(splatLabel, splat.uv, 0).r * 255.0;
                if (label > 0.5) {
                    let safeMax = max(1.0, uniform.uLabelMax);
                    let hue = (label - 1.0) / safeMax;
                    let bandSize = max(1.0, uniform.uLabelSatBandSize);
                    let band = f32(u32((label - 1.0) / bandSize) % 2u);
                    let sat = mix(0.25, 1.0, band);
                    let k = vec4f(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                    let p = abs(fract(vec3f(hue) + k.xyz) * 6.0 - vec3f(k.w));
                    let labelColor = mix(vec3f(k.x), clamp(p - vec3f(k.x), vec3f(0.0), vec3f(1.0)), sat);
                    (*color) = vec4f(mix((*color).rgb, labelColor, clamp(uniform.uLabelBlend, 0.0, 1.0)), (*color).a);
                }
            }
        }
    `
};
