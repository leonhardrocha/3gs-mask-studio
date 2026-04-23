// cone-shader.vert.glsl
// Cone helper visual para feedback do volume de selecao.

attribute vec4 aPosition;

uniform mat4 matrix_viewProjection;
uniform mat4 matrix_model;
uniform float uConeRange;
uniform float uConeAngleTan;

varying vec3 vLocalPos;

void main(void) {
    vLocalPos = aPosition.xyz;

    vec4 scaled = aPosition;
    scaled.y *= uConeRange;
    scaled.xz *= uConeRange * uConeAngleTan;

    gl_Position = matrix_viewProjection * matrix_model * scaled;
}
