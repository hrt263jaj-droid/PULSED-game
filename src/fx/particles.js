import * as THREE from 'three'

/**
 * All three systems here are animated entirely on the GPU: the CPU writes a
 * spawn record once and then only ever updates a `uTime` uniform. Nothing is
 * simulated per-frame in JavaScript, so particle count barely affects the
 * frame budget.
 */

// ---------------------------------------------------------------------------
// Collection / impact bursts
// ---------------------------------------------------------------------------

const PARTICLES_PER_BURST = 44

export class BurstSystem {
  constructor(scene, settings) {
    this.capacity = Math.max(
      PARTICLES_PER_BURST * 10,
      Math.round(4000 * settings.particleScale)
    )
    this.head = 0
    this.dirty = false

    const origins = new Float32Array(this.capacity * 3)
    const velocities = new Float32Array(this.capacity * 3)
    // Inherited motion: without it the craft outruns its own debris within a
    // couple of frames and the burst is gone before you register it.
    const drifts = new Float32Array(this.capacity * 3)
    const colors = new Float32Array(this.capacity * 3)
    const spawns = new Float32Array(this.capacity).fill(-999)
    const sizes = new Float32Array(this.capacity)
    const lifetimes = new Float32Array(this.capacity).fill(1)

    const geometry = new THREE.BufferGeometry()
    // `position` is unused by the shader but three requires it to size the draw.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3))
    geometry.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 3))
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3))
    geometry.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 3))
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSpawn', new THREE.BufferAttribute(spawns, 1))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aLife', new THREE.BufferAttribute(lifetimes, 1))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    this.attrs = { origins, velocities, drifts, colors, spawns, sizes, lifetimes }
    this.geometry = geometry

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOrigin;
        attribute vec3 aVelocity;
        attribute vec3 aDrift;
        attribute vec3 aColor;
        attribute float aSpawn;
        attribute float aSize;
        attribute float aLife;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vFlash;

        uniform float uTime;
        uniform float uScale;

        void main() {
          float age = uTime - aSpawn;
          if (age < 0.0 || age > aLife) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // park offscreen
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }

          float t = age / aLife;
          // Drag, so the burst snaps outward hard then coasts.
          float drag = 1.0 - exp(-age * 4.5);
          vec3 pos = aOrigin + aVelocity * drag * 0.30 + aDrift * age;
          pos.y -= 5.0 * age * age; // gentle fall

          vColor = aColor;
          vAlpha = pow(1.0 - t, 1.5);
          // Hot white core for the first instant of the pop.
          vFlash = pow(1.0 - min(1.0, age / 0.12), 2.0);

          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;

          float size = aSize * uScale * (1.0 - t * 0.5) * (300.0 / max(1.0, -mv.z));
          gl_PointSize = clamp(size, 1.0, 110.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vFlash;

        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float falloff = pow(1.0 - r * 2.0, 1.7);
          // The white core blooms hardest of anything here, so it stays low --
          // the burst reads through its motion and count, not raw brightness.
          vec3 col = vColor * (1.05 + falloff * 1.1) + vec3(vFlash) * 0.45;
          gl_FragColor = vec4(col, falloff * vAlpha);
        }
      `,
    })

    this.points = new THREE.Points(geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 3
    scene.add(this.points)
    this.scene = scene
  }

  /**
   * @param {THREE.Vector3} position
   * @param {THREE.Color} color
   * @param {number} time       current song time
   * @param {number} intensity  0..1
   * @param {THREE.Vector3} [drift]  motion to inherit (usually the craft's)
   */
  emit(position, color, time, intensity = 1, drift = null) {
    const { origins, velocities, drifts, colors, spawns, sizes, lifetimes } = this.attrs
    const count = Math.round(PARTICLES_PER_BURST * (0.65 + intensity * 0.55))

    const dx = drift ? drift.x : 0
    const dy = drift ? drift.y : 0
    const dz = drift ? drift.z : 0

    for (let n = 0; n < count; n++) {
      const i = this.head
      this.head = (this.head + 1) % this.capacity

      origins[i * 3] = position.x
      origins[i * 3 + 1] = position.y
      origins[i * 3 + 2] = position.z

      // Random direction on a sphere, biased upward and outward.
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      const speed = (14 + Math.random() * 34) * (0.65 + intensity)
      velocities[i * 3] = r * Math.cos(theta) * speed
      velocities[i * 3 + 1] = (u * 0.55 + 0.75) * speed
      velocities[i * 3 + 2] = r * Math.sin(theta) * speed

      drifts[i * 3] = dx
      drifts[i * 3 + 1] = dy
      drifts[i * 3 + 2] = dz

      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b

      spawns[i] = time
      // Sized in the same units the point-size formula expects: at the chase
      // camera's ~25 unit distance this lands around 20-50px, not the 4px the
      // original values produced.
      sizes[i] = 0.75 + Math.random() * Math.random() * 2.1
      lifetimes[i] = 0.6 + Math.random() * 0.55
    }

    this.dirty = true
  }

  update(time, pixelRatio) {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uScale.value = pixelRatio

    if (this.dirty) {
      for (const key of ['aOrigin', 'aVelocity', 'aDrift', 'aColor', 'aSpawn', 'aSize', 'aLife']) {
        this.geometry.getAttribute(key).needsUpdate = true
      }
      this.dirty = false
    }
  }

  reset() {
    this.attrs.spawns.fill(-999)
    this.dirty = true
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    this.scene.remove(this.points)
  }
}

// ---------------------------------------------------------------------------
// Shockwave rings
// ---------------------------------------------------------------------------

/**
 * A single expanding ring per hit. Drawn as a point sprite with an annulus in
 * the fragment shader -- no geometry, no billboarding math, one draw call for
 * every ring on screen.
 */
export class RingSystem {
  constructor(scene, settings) {
    this.capacity = Math.max(24, Math.round(80 * settings.particleScale))
    this.head = 0
    this.dirty = false

    const origins = new Float32Array(this.capacity * 3)
    const drifts = new Float32Array(this.capacity * 3)
    const colors = new Float32Array(this.capacity * 3)
    const spawns = new Float32Array(this.capacity).fill(-999)
    const scales = new Float32Array(this.capacity).fill(1)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3))
    geometry.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 3))
    geometry.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 3))
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSpawn', new THREE.BufferAttribute(spawns, 1))
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    this.attrs = { origins, drifts, colors, spawns, scales }
    this.geometry = geometry

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uLife: { value: 0.42 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOrigin;
        attribute vec3 aDrift;
        attribute vec3 aColor;
        attribute float aSpawn;
        attribute float aScale;

        varying vec3 vColor;
        varying float vAlpha;

        uniform float uTime;
        uniform float uScale;
        uniform float uLife;

        void main() {
          float age = uTime - aSpawn;
          if (age < 0.0 || age > uLife) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }

          float t = age / uLife;
          vColor = aColor;
          vAlpha = pow(1.0 - t, 2.0);

          vec3 pos = aOrigin + aDrift * age;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;

          // Ease-out expansion: fast snap outward, then slow.
          float growth = 1.0 - pow(1.0 - t, 2.4);
          // Tuned so a normal pickup's ring expands well past the block it
          // replaces -- at ring parity with the block it just reads as a fade.
          float size = aScale * uScale * growth * (1600.0 / max(1.0, -mv.z));
          gl_PointSize = clamp(size, 1.0, 400.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          // Annulus: bright at the rim, hollow in the middle.
          float ring = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
          if (ring < 0.01) discard;
          gl_FragColor = vec4(vColor * 1.55, ring * vAlpha);
        }
      `,
    })

    this.points = new THREE.Points(geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 4
    scene.add(this.points)
    this.scene = scene
  }

  emit(position, color, time, scale = 1, drift = null) {
    const { origins, drifts, colors, spawns, scales } = this.attrs
    const i = this.head
    this.head = (this.head + 1) % this.capacity

    origins[i * 3] = position.x
    origins[i * 3 + 1] = position.y
    origins[i * 3 + 2] = position.z

    drifts[i * 3] = drift ? drift.x : 0
    drifts[i * 3 + 1] = drift ? drift.y : 0
    drifts[i * 3 + 2] = drift ? drift.z : 0

    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b

    spawns[i] = time
    scales[i] = scale

    this.dirty = true
  }

  update(time, pixelRatio) {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uScale.value = pixelRatio

    if (this.dirty) {
      for (const key of ['aOrigin', 'aDrift', 'aColor', 'aSpawn', 'aScale']) {
        this.geometry.getAttribute(key).needsUpdate = true
      }
      this.dirty = false
    }
  }

  reset() {
    this.attrs.spawns.fill(-999)
    this.dirty = true
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    this.scene.remove(this.points)
  }
}

// ---------------------------------------------------------------------------
// Ambient dust -- the parallax that sells velocity
// ---------------------------------------------------------------------------

const FIELD_SIZE = 240

export class DustField {
  constructor(scene, palette, settings) {
    const count = Math.round(1800 * settings.particleScale)
    const positions = new Float32Array(Math.max(1, count) * 3)
    const sizes = new Float32Array(Math.max(1, count))

    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * FIELD_SIZE
      positions[i * 3 + 1] = Math.random() * FIELD_SIZE
      positions[i * 3 + 2] = Math.random() * FIELD_SIZE
      sizes[i] = 0.4 + Math.random() * 1.6
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(palette.accent) },
        uSpeed: { value: 0 },
        uScale: { value: 1 },
        uField: { value: FIELD_SIZE },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        varying float vAlpha;

        uniform vec3 uCamPos;
        uniform float uSpeed;
        uniform float uScale;
        uniform float uField;

        void main() {
          // Tile the field around the camera so it's effectively infinite and
          // never needs repositioning on the CPU.
          vec3 p = mod(position - uCamPos, uField) - uField * 0.5 + uCamPos;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;

          // Fade out very close particles so they don't strobe past the lens.
          vAlpha = smoothstep(3.0, 25.0, dist) * (1.0 - smoothstep(uField * 0.35, uField * 0.5, dist));
          vAlpha *= 0.25 + uSpeed * 0.6;

          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale * (110.0 / max(1.0, dist)) * (1.0 + uSpeed);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vAlpha;
        uniform vec3 uColor;

        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float falloff = pow(1.0 - r * 2.0, 2.0);
          gl_FragColor = vec4(uColor, falloff * vAlpha * 0.55);
        }
      `,
    })

    this.points = new THREE.Points(geometry, this.material)
    this.points.frustumCulled = false
    scene.add(this.points)
    this.scene = scene
    this.geometry = geometry
  }

  update(camera, speed01, pixelRatio) {
    this.material.uniforms.uCamPos.value.copy(camera.position)
    this.material.uniforms.uSpeed.value = speed01
    this.material.uniforms.uScale.value = pixelRatio
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    this.scene.remove(this.points)
  }
}
