// Bildaufbau: Kantenglaettung (MSAA plus hoehere Aufloesung) und feine Schatten in Ecken und Rillen.
import * as THREE from './vendor/build/three.module.js';

const FULLSCREEN = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Umgebungsverdeckung in zwei Groessen: klein fuer Rillen und Kanten, gross fuer Nischen.
const OCCLUSION = /* glsl */`
uniform sampler2D tDepth;
uniform vec2 uSize;
uniform mat4 uProjection;
uniform mat4 uInverse;
uniform float uFine;
uniform float uWide;
varying vec2 vUv;

vec3 viewAt(vec2 uv) {
  float depth = texture2D(tDepth, uv).x;
  vec4 p = uInverse * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

float occlusion(vec3 p, vec3 n, float radius, float turn) {
  float pixels = radius * uProjection[1][1] * 0.5 * uSize.y / -p.z;
  pixels = clamp(pixels, 2.0, 90.0);
  float sum = 0.0;
  for (int i = 0; i < 14; i++) {
    float f = (float(i) + 0.5) / 14.0;
    float a = float(i) * 2.399963 + turn;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * max(1.5, pixels * sqrt(f)) / uSize;
    if (texture2D(tDepth, uv).x >= 0.999999) continue;
    vec3 d = viewAt(uv) - p;
    float len2 = dot(d, d);
    float reach = max(0.0, 1.0 - len2 / (radius * radius * 4.0));
    sum += max(0.0, dot(n, d) / sqrt(len2 + 1e-6) - 0.22) * reach;
  }
  return sum / 14.0;
}

void main() {
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 0.999999) {
    gl_FragColor = vec4(1.0);
    return;
  }
  vec3 p = viewAt(vUv);
  // Ueber mehrere Pixel, damit einzelne Schichtrillen die Normale nicht kippen.
  vec2 dx = vec2(3.0 / uSize.x, 0.0);
  vec2 dy = vec2(0.0, 3.0 / uSize.y);
  // Jeweils der naehere Nachbar, sonst zerreissen die Normalen an Umrissen.
  vec3 r = viewAt(vUv + dx) - p;
  vec3 l = p - viewAt(vUv - dx);
  vec3 t = viewAt(vUv + dy) - p;
  vec3 b = p - viewAt(vUv - dy);
  vec3 n = normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(t.z) < abs(b.z) ? t : b));
  float turn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  float dark = occlusion(p, n, uFine, turn) * 1.35 + occlusion(p, n, uWide, turn + 1.3) * 0.85;
  gl_FragColor = vec4(vec3(clamp(1.0 - dark, 0.22, 1.0)), 1.0);
}`;

const COMPOSE = /* glsl */`
uniform sampler2D tColour;
uniform sampler2D tDepth;
uniform sampler2D tShade;
uniform vec2 uShadeSize;
uniform float uNear;
uniform float uFar;
uniform float uStrength;
varying vec2 vUv;

float distanceAt(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec3 colour = texture2D(tColour, vUv).rgb;
  float centre = distanceAt(vUv);
  float sum = 0.0;
  float weights = 0.0;
  for (int x = -1; x <= 2; x++) {
    for (int y = -1; y <= 2; y++) {
      vec2 uv = vUv + (vec2(float(x), float(y)) - 0.5) / uShadeSize;
      float w = exp(-abs(distanceAt(uv) - centre) / max(0.3, centre * 0.006));
      sum += texture2D(tShade, uv).r * w;
      weights += w;
    }
  }
  float shade = weights > 1e-4 ? sum / weights : 1.0;
  gl_FragColor = vec4(colour * mix(1.0, shade, uStrength), 1.0);
  #include <colorspace_fragment>
}`;

export class RenderPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    const samples = Math.min(4, renderer.capabilities.maxSamples || 0);
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {samples, depthTexture, type: THREE.HalfFloatType});
    this.shadeTarget = new THREE.WebGLRenderTarget(1, 1, {depthBuffer: false});
    const pass = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({vertexShader: FULLSCREEN, fragmentShader, uniforms, depthTest: false, depthWrite: false});
    this.occlusion = pass(OCCLUSION, {
      tDepth: {value: depthTexture},
      uSize: {value: new THREE.Vector2(1, 1)},
      uProjection: {value: new THREE.Matrix4()},
      uInverse: {value: new THREE.Matrix4()},
      uFine: {value: 0.8},
      uWide: {value: 4},
    });
    this.compose = pass(COMPOSE, {
      tColour: {value: this.sceneTarget.texture},
      tDepth: {value: depthTexture},
      tShade: {value: this.shadeTarget.texture},
      uShadeSize: {value: new THREE.Vector2(1, 1)},
      uNear: {value: 1},
      uFar: {value: 1000},
      uStrength: {value: 1},
    });
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compose);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.shadows = true;
  }

  /** @param width,height CSS-Pixel */
  setSize(width, height, ratio) {
    this.sceneTarget.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
    this.shadeTarget.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
    this.compose.uniforms.uShadeSize.value.set(this.shadeTarget.width, this.shadeTarget.height);
    this.occlusion.uniforms.uSize.value.set(this.shadeTarget.width, this.shadeTarget.height);
  }

  render(scene, camera) {
    const {renderer} = this;
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    if (this.shadows) {
      const u = this.occlusion.uniforms;
      u.uProjection.value.copy(camera.projectionMatrix);
      u.uInverse.value.copy(camera.projectionMatrixInverse);
      this.quad.material = this.occlusion;
      renderer.setRenderTarget(this.shadeTarget);
      renderer.render(this.quadScene, this.quadCamera);
    }

    const c = this.compose.uniforms;
    c.uNear.value = camera.near;
    c.uFar.value = camera.far;
    c.uStrength.value = this.shadows ? 1 : 0;
    this.quad.material = this.compose;
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }
}
