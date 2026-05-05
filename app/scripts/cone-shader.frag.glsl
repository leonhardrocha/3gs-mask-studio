// cone-shader.frag.glsl
// Decaimento gaussiano radial para visualizacao suave do cone.

precision mediump float;

varying vec3 vLocalPos;
uniform vec4 uConeColor;

void main(void) {
    float r = length(vLocalPos.xz);
    float alpha = exp(-2.0 * r * r) * uConeColor.a;

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(uConeColor.rgb, alpha);
}
