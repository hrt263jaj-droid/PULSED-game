import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/**
 * Final grade: vignette, speed-driven chromatic aberration, and a whisper of
 * grain to stop the large flat gradients of deep space from banding.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 }, // 0..1, normalized velocity
    uCombo: { value: 0 },
    uHit: { value: 0 }, // decays after hitting a hazard
    uTint: { value: new THREE.Color('#ffffff') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;

    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uCombo;
    uniform float uHit;
    uniform vec3 uTint;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 fromCenter = uv - 0.5;
      float dist = length(fromCenter);

      // Chromatic aberration scales with speed and spikes on damage, so the
      // screen literally strains when you're going fast.
      float aberration = (uSpeed * 0.0022 + uHit * 0.008) * dist;
      vec3 col;
      col.r = texture2D(tDiffuse, uv - fromCenter * aberration).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + fromCenter * aberration).b;

      // Radial streak toward the edges at speed.
      float streak = uSpeed * 0.35;
      if (streak > 0.01) {
        vec3 blur = vec3(0.0);
        for (int i = 1; i <= 4; i++) {
          float s = float(i) / 4.0;
          blur += texture2D(tDiffuse, uv - fromCenter * s * 0.045 * streak).rgb;
        }
        col = mix(col, blur * 0.25, streak * 0.30);
      }

      // Combo warms the image toward the song's own accent color.
      col = mix(col, col * uTint, uCombo * 0.35);

      // Damage flash.
      col += vec3(0.55, 0.06, 0.10) * uHit * (0.35 + dist);

      // Vignette, tightening slightly with speed.
      float vig = smoothstep(0.95, 0.28 - uSpeed * 0.06, dist);
      col *= vig;

      // Grain.
      col += (hash(uv * 900.0 + fract(uTime) * 100.0) - 0.5) * 0.018;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

export class PostStack {
  constructor(renderer, scene, camera, settings, palette) {
    this.renderer = renderer
    this.settings = settings
    this.enabled = settings.bloom || settings.grade

    this.composer = new EffectComposer(renderer)
    this.composer.addPass(new RenderPass(scene, camera))

    if (settings.bloom) {
      const size = renderer.getSize(new THREE.Vector2())
      this.bloom = new UnrealBloomPass(
        size.multiplyScalar(settings.bloomResolutionScale),
        settings.bloomStrength,
        0.75, // radius
        0.62 // threshold -- only genuinely emissive things bloom
      )
      this.composer.addPass(this.bloom)
      this.baseBloomStrength = settings.bloomStrength
    }

    if (settings.grade) {
      this.grade = new ShaderPass(GradeShader)
      this.grade.uniforms.uTint.value = new THREE.Color(palette.bloomTint)
      this.composer.addPass(this.grade)
    }

    this.composer.addPass(new OutputPass())
  }

  /**
   * @param {object} state { time, speed01, combo01, hit01 }
   */
  update(state) {
    if (this.grade) {
      const u = this.grade.uniforms
      u.uTime.value = state.time
      u.uSpeed.value = state.speed01
      u.uCombo.value = state.combo01
      u.uHit.value = state.hit01
    }
    if (this.bloom) {
      // The world overloads as the combo climbs.
      this.bloom.strength = this.baseBloomStrength * (1 + state.combo01 * 0.9)
      this.bloom.threshold = 0.62 - state.combo01 * 0.18
    }
  }

  setSize(width, height) {
    this.composer.setSize(width, height)
    if (this.bloom) {
      this.bloom.resolution.set(
        Math.max(1, Math.round(width * this.settings.bloomResolutionScale)),
        Math.max(1, Math.round(height * this.settings.bloomResolutionScale))
      )
    }
  }

  render(scene, camera, deltaTime) {
    if (this.enabled) this.composer.render(deltaTime)
    else this.renderer.render(scene, camera)
  }

  dispose() {
    this.composer?.dispose?.()
  }
}
