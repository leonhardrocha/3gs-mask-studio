/**
 * Work-buffer modifier shared by every selectable splat.
 *
 * Runs in the "copy to work buffer" pass (engine `gsplatCopyToWorkbuffer` +
 * `gsplatModify` chunks). The three hooks operate in WORLD space and can read
 * per-splat instance streams via `texelFetch(<stream>, splat.uv, 0)`.
 *
 * Responsibilities:
 *   1. Apply COMMITTED per-splat edits (similarity transform + color override)
 *      stored in the `editQuat` / `editTS` / `editColor` streams.
 *   2. Apply the LIVE active-op preview (uniforms) to splats where
 *      `selectionMask > 0`.
 *   3. Highlight selected splats; optional Paul Tol / HSV label viewer.
 *
 * Edits are stored as a per-splat SIMILARITY transform applied to the base
 * (unedited) world center the GPU already provides:
 *   editedCenter = editTS.xyz + editTS.w * rotate(editQuat, baseCenter)
 * Defaults: editQuat = (0,0,0,1), editTS = (0,0,0,1) → identity (no-op).
 */

export const workBufferModifier = {
    glsl: /* glsl */`
        // Active op preview uniforms
        uniform float uHasActiveOp;
        uniform vec4 uActiveQuat;   // (x,y,z,w)
        uniform vec4 uActiveTS;     // xyz = translate, w = uniform scale
        uniform vec3 uActivePivot;
        uniform vec4 uActiveColor;  // rgb, a = apply flag

        uniform vec3 uSelHighlightColor;
        uniform float uSelHighlightStrength;

        uniform float uLabelColoring;
        uniform float uLabelBlend;
        uniform float uLabelMax;
        uniform float uLabelSatBandSize;
        uniform float uLabelColorMapMode;
        uniform float uLabelColorScheme;

        vec3 sp_rotq(vec4 q, vec3 v) {
            return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
        }
        vec4 sp_qmul(vec4 a, vec4 b) {
            return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
        }
        float sp_selected() { return texelFetch(selectionMask, splat.uv, 0).r; }

        vec3 brightColor(int idx) {
            vec3 p[7];
            p[0] = vec3(0.2667, 0.4667, 0.6667); p[1] = vec3(0.9333, 0.4000, 0.4667);
            p[2] = vec3(0.1333, 0.5333, 0.2000); p[3] = vec3(0.8000, 0.7333, 0.2667);
            p[4] = vec3(0.4000, 0.8000, 0.9333); p[5] = vec3(0.6667, 0.2000, 0.4667);
            p[6] = vec3(0.7333, 0.7333, 0.7333);
            return p[idx % 7];
        }
        vec3 vibrantColor(int idx) {
            vec3 p[7];
            p[0] = vec3(0.0000, 0.4667, 0.7333); p[1] = vec3(0.2000, 0.7333, 0.9333);
            p[2] = vec3(0.0000, 0.6000, 0.5333); p[3] = vec3(0.9333, 0.4667, 0.2000);
            p[4] = vec3(0.8000, 0.2000, 0.0667); p[5] = vec3(0.9333, 0.2000, 0.4667);
            p[6] = vec3(0.7333, 0.7333, 0.7333);
            return p[idx % 7];
        }
        vec3 mutedColor(int idx) {
            vec3 p[9];
            p[0] = vec3(0.2000, 0.1333, 0.5333); p[1] = vec3(0.5333, 0.8000, 0.9333);
            p[2] = vec3(0.2667, 0.6667, 0.6000); p[3] = vec3(0.0667, 0.4667, 0.2000);
            p[4] = vec3(0.6000, 0.6000, 0.2000); p[5] = vec3(0.8667, 0.8000, 0.4667);
            p[6] = vec3(0.8000, 0.4000, 0.4667); p[7] = vec3(0.5333, 0.1333, 0.3333);
            p[8] = vec3(0.6667, 0.2667, 0.6000);
            return p[idx % 9];
        }
        vec3 sunsetColor(int idx) {
            vec3 p[11];
            p[0] = vec3(0.2118, 0.2941, 0.6275); p[1] = vec3(0.2902, 0.4824, 0.7176);
            p[2] = vec3(0.4314, 0.6314, 0.7922); p[3] = vec3(0.5961, 0.7922, 0.8824);
            p[4] = vec3(0.7608, 0.8941, 0.9373); p[5] = vec3(0.9176, 0.9255, 0.8000);
            p[6] = vec3(0.9961, 0.8549, 0.5451); p[7] = vec3(0.9922, 0.7059, 0.3843);
            p[8] = vec3(0.9569, 0.5137, 0.3020); p[9] = vec3(0.8353, 0.2431, 0.3098);
            p[10] = vec3(0.6471, 0.0000, 0.1490);
            return p[idx % 11];
        }
        vec3 highContrastColor(int idx) {
            int s = int(floor(uLabelColorScheme + 0.5));
            if (s == 1) return vibrantColor(idx);
            if (s == 2) return mutedColor(idx);
            if (s == 3) return sunsetColor(idx);
            return brightColor(idx);
        }

        void modifySplatCenter(inout vec3 center) {
            vec4 q = texelFetch(editQuat, splat.uv, 0);
            vec4 ts = texelFetch(editTS, splat.uv, 0);
            vec3 c = ts.xyz + ts.w * sp_rotq(q, center);
            if (uHasActiveOp > 0.5 && sp_selected() > 0.5) {
                c = uActivePivot + uActiveTS.w * sp_rotq(uActiveQuat, c - uActivePivot) + uActiveTS.xyz;
            }
            center = c;
        }

        void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
            vec4 q = texelFetch(editQuat, splat.uv, 0);
            vec4 ts = texelFetch(editTS, splat.uv, 0);
            rotation = sp_qmul(q, rotation);
            scale = scale * ts.w;
            if (uHasActiveOp > 0.5 && sp_selected() > 0.5) {
                rotation = sp_qmul(uActiveQuat, rotation);
                scale = scale * uActiveTS.w;
            }
        }

        void modifySplatColor(vec3 center, inout vec4 color) {
            // committed color override
            vec4 ec = texelFetch(editColor, splat.uv, 0);
            if (ec.a > 0.5) color.rgb = ec.rgb;

            // active color preview
            float sel = sp_selected();
            if (uHasActiveOp > 0.5 && sel > 0.5 && uActiveColor.a > 0.5) color.rgb = uActiveColor.rgb;

            // label viewer (optional)
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
                        vec3 pp = abs(fract(vec3(hue) + K.xyz) * 6.0 - K.www);
                        labelColor = mix(K.xxx, clamp(pp - K.xxx, 0.0, 1.0), sat);
                    }
                    color.rgb = mix(color.rgb, labelColor, clamp(uLabelBlend, 0.0, 1.0));
                }
            }

            // selection highlight (last, so it reads clearly)
            if (sel > 0.5) {
                color.rgb = mix(color.rgb, uSelHighlightColor, clamp(uSelHighlightStrength, 0.0, 1.0));
            }
        }
    `,
    wgsl: /* wgsl */`
        uniform uHasActiveOp: f32;
        uniform uActiveQuat: vec4f;
        uniform uActiveTS: vec4f;
        uniform uActivePivot: vec3f;
        uniform uActiveColor: vec4f;

        uniform uSelHighlightColor: vec3f;
        uniform uSelHighlightStrength: f32;

        uniform uLabelColoring: f32;
        uniform uLabelBlend: f32;
        uniform uLabelMax: f32;
        uniform uLabelSatBandSize: f32;
        uniform uLabelColorMapMode: f32;
        uniform uLabelColorScheme: f32;

        fn sp_rotq(q: vec4f, v: vec3f) -> vec3f {
            return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
        }
        fn sp_qmul(a: vec4f, b: vec4f) -> vec4f {
            return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
        }
        fn sp_selected() -> f32 { return textureLoad(selectionMask, splat.uv, 0).r; }

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
            let s = i32(floor(uniform.uLabelColorScheme + 0.5));
            if (s == 1) { return vibrantColor(idx); }
            if (s == 2) { return mutedColor(idx); }
            if (s == 3) { return sunsetColor(idx); }
            return brightColor(idx);
        }

        fn modifySplatCenter(center: ptr<function, vec3f>) {
            let q = textureLoad(editQuat, splat.uv, 0);
            let ts = textureLoad(editTS, splat.uv, 0);
            var c = ts.xyz + ts.w * sp_rotq(q, *center);
            if (uniform.uHasActiveOp > 0.5 && sp_selected() > 0.5) {
                c = uniform.uActivePivot + uniform.uActiveTS.w * sp_rotq(uniform.uActiveQuat, c - uniform.uActivePivot) + uniform.uActiveTS.xyz;
            }
            *center = c;
        }

        fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
            let q = textureLoad(editQuat, splat.uv, 0);
            let ts = textureLoad(editTS, splat.uv, 0);
            *rotation = sp_qmul(q, *rotation);
            *scale = *scale * ts.w;
            if (uniform.uHasActiveOp > 0.5 && sp_selected() > 0.5) {
                *rotation = sp_qmul(uniform.uActiveQuat, *rotation);
                *scale = *scale * uniform.uActiveTS.w;
            }
        }

        fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
            let ec = textureLoad(editColor, splat.uv, 0);
            if (ec.a > 0.5) { (*color).rgb = ec.rgb; }

            let sel = sp_selected();
            if (uniform.uHasActiveOp > 0.5 && sel > 0.5 && uniform.uActiveColor.a > 0.5) {
                (*color).rgb = uniform.uActiveColor.rgb;
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
                        let pp = abs(fract(vec3f(hue) + k.xyz) * 6.0 - k.www);
                        labelColor = mix(k.xxx, clamp(pp - k.xxx, vec3f(0.0), vec3f(1.0)), vec3f(sat));
                    }
                    (*color).rgb = mix((*color).rgb, labelColor, clamp(uniform.uLabelBlend, 0.0, 1.0));
                }
            }

            if (sel > 0.5) {
                (*color).rgb = mix((*color).rgb, uniform.uSelHighlightColor, clamp(uniform.uSelHighlightStrength, 0.0, 1.0));
            }
        }
    `
};
