import * as THREE from 'three'

/**
 * The backdrop deliberately carries no high-frequency detail: it's large, soft
 * and low-contrast so it never competes with the road or the blocks. All the
 * "cosmic" comes from slow-moving nebula gradients and a deep starfield, both
 * of which sit far enough back to read as atmosphere rather than obstacles.
 */

const noiseGLSL = /* glsl */ `
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
  }

  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
              dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
          mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
              dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
      mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
              dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
          mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
              dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y),
      u.z) * 0.5 + 0.5;
  }
`

export class Environment {
  constructor(scene, palette, settings) {
    this.scene = scene
    this.settings = settings
    this.group = new THREE.Group()
    scene.add(this.group)

    this._buildSky(palette, settings)
    this._buildStars(palette, settings)
  }

  _buildSky(palette, settings) {
    // Inverted sphere that rides along with the camera, so it reads as
    // infinitely distant and never pops or clips.
    const geometry = new THREE.SphereGeometry(1, 32, 24)

    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uLayers: { value: Math.max(1, settings.nebulaLayers) },
        uNebulaA: { value: new THREE.Color(palette.nebulaA) },
        uNebulaB: { value: new THREE.Color(palette.nebulaB) },
        uDeep: { value: new THREE.Color(palette.fog) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vDir;

        uniform float uTime;
        uniform float uBass;
        uniform float uLayers;
        uniform vec3 uNebulaA;
        uniform vec3 uNebulaB;
        uniform vec3 uDeep;

        ${noiseGLSL}

        float fbm(vec3 p) {
          float total = 0.0;
          float amp = 0.5;
          float maxAmp = 0.0;
          for (int i = 0; i < 5; i++) {
            if (float(i) >= uLayers) break;
            total += vnoise(p) * amp;
            maxAmp += amp;
            p *= 2.03;
            amp *= 0.5;
          }
          return maxAmp > 0.0 ? total / maxAmp : 0.5;
        }

        void main() {
          vec3 dir = normalize(vDir);
          // Very slow drift -- movement you notice only if you look for it.
          vec3 p = dir * 2.2 + vec3(0.0, 0.0, uTime * 0.012);

          float n = fbm(p);
          float m = fbm(p * 1.7 + vec3(4.2, 1.3, -2.8));

          vec3 col = uDeep;
          col = mix(col, uNebulaA, smoothstep(0.42, 0.85, n) * 0.85);
          col = mix(col, uNebulaB, smoothstep(0.50, 0.92, m) * 0.65);

          // Bass swells breathe light through the clouds.
          col *= 0.75 + uBass * 0.55;

          // Darken toward the nadir so the road always has something to sit
          // against, and lift the zenith slightly.
          col *= mix(0.45, 1.15, smoothstep(-0.6, 0.5, dir.y));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })

    this.sky = new THREE.Mesh(geometry, this.skyMaterial)
    this.sky.scale.setScalar(1)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -1000
    this.group.add(this.sky)
  }

  _buildStars(palette, settings) {
    const count = settings.starCount
    if (count <= 0) return

    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const phases = new Float32Array(count)
    const tints = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      // Uniform on a sphere shell.
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      positions[i * 3] = r * Math.cos(theta)
      positions[i * 3 + 1] = u
      positions[i * 3 + 2] = r * Math.sin(theta)

      sizes[i] = 0.6 + Math.random() * Math.random() * 3.2
      phases[i] = Math.random() * Math.PI * 2
      tints[i] = Math.random()
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 1))

    this.starMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uTreble: { value: 0 },
        uScale: { value: 1 },
        uColorA: { value: new THREE.Color('#ffffff') },
        uColorB: { value: new THREE.Color(palette.accent) },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aPhase;
        attribute float aTint;

        varying float vAlpha;
        varying float vTint;

        uniform float uTime;
        uniform float uTreble;
        uniform float uScale;

        void main() {
          vTint = aTint;
          // Twinkle, with high frequencies making the field shimmer.
          float twinkle = 0.55 + 0.45 * sin(uTime * 1.6 + aPhase);
          vAlpha = twinkle * (0.45 + uTreble * 0.75);

          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale * (1.0 + uTreble * 0.6);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vAlpha;
        varying float vTint;
        uniform vec3 uColorA;
        uniform vec3 uColorB;

        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float falloff = pow(1.0 - r * 2.0, 2.2);
          vec3 col = mix(uColorA, uColorB, vTint * 0.7);
          gl_FragColor = vec4(col, falloff * vAlpha);
        }
      `,
    })

    this.stars = new THREE.Points(geometry, this.starMaterial)
    this.stars.frustumCulled = false
    this.stars.renderOrder = -999
    this.group.add(this.stars)
  }

  /**
   * @param {THREE.Camera} camera
   * @param {object} bands { bass, treble } 0..1
   */
  update(time, camera, bands, pixelRatio) {
    // Both layers are pinned to the camera so they behave as infinite backdrop.
    const far = camera.far * 0.9
    this.sky.position.copy(camera.position)
    this.sky.scale.setScalar(far)

    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uTime.value = time
      this.skyMaterial.uniforms.uBass.value = bands.bass
    }

    if (this.stars) {
      this.stars.position.copy(camera.position)
      this.stars.scale.setScalar(far * 0.95)
      this.starMaterial.uniforms.uTime.value = time
      this.starMaterial.uniforms.uTreble.value = bands.treble
      this.starMaterial.uniforms.uScale.value = pixelRatio
    }
  }

  dispose() {
    this.group.traverse((obj) => {
      obj.geometry?.dispose()
      obj.material?.dispose()
    })
    this.scene.remove(this.group)
  }
}
