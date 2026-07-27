import * as THREE from 'three'

/**
 * A hovering craft rather than a car: with no wheel contact to fake, steep
 * crests and banked turns cost nothing, and the engine glow gives us a free
 * hook for bass reactivity.
 *
 * Geometry is procedural -- crystalline facets to match the cosmic setting,
 * and no asset pipeline to maintain.
 */
export class Vessel {
  constructor(scene, palette) {
    this.group = new THREE.Group()
    scene.add(this.group)

    const accent = new THREE.Color(palette.accent)
    const primary = new THREE.Color(palette.primary)

    // --- hull -------------------------------------------------------------
    const hullGeo = new THREE.OctahedronGeometry(1, 0)
    // Not too flat: the chase camera sits only ~13 degrees above the craft, so
    // a wafer-thin hull presents almost no silhouette from behind.
    hullGeo.scale(0.62, 0.52, 1.65)
    this.hull = new THREE.Mesh(
      hullGeo,
      new THREE.MeshStandardMaterial({
        color: '#0d1424',
        emissive: primary,
        emissiveIntensity: 0.45,
        metalness: 0.85,
        roughness: 0.28,
        flatShading: true,
      })
    )
    this.group.add(this.hull)

    // --- wings ------------------------------------------------------------
    const wingGeo = new THREE.OctahedronGeometry(1, 0)
    // Half-span here (x * the group's 2.2 scale) is kept to roughly the block
    // collection radius, so the craft catches what it looks like it should.
    wingGeo.scale(0.9, 0.07, 0.5)
    this.wings = new THREE.Mesh(
      wingGeo,
      new THREE.MeshStandardMaterial({
        color: '#0a0f1c',
        emissive: accent,
        emissiveIntensity: 0.7,
        metalness: 0.9,
        roughness: 0.35,
        flatShading: true,
      })
    )
    this.wings.position.z = -0.15
    this.group.add(this.wings)

    // --- dorsal fin -------------------------------------------------------
    // Purely for readability: gives the craft a recognisable profile against
    // the road when viewed from directly behind.
    const finGeo = new THREE.OctahedronGeometry(1, 0)
    finGeo.scale(0.07, 0.52, 0.62)
    finGeo.translate(0, 0.42, -0.45)
    this.fin = new THREE.Mesh(
      finGeo,
      new THREE.MeshStandardMaterial({
        color: '#111a2e',
        emissive: accent,
        emissiveIntensity: 1.1,
        metalness: 0.8,
        roughness: 0.3,
        flatShading: true,
      })
    )
    this.group.add(this.fin)

    // --- engine core ------------------------------------------------------
    // Unlit and bright so it drives the bloom directly.
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false })
    const coreGeo = new THREE.SphereGeometry(0.17, 16, 12)
    coreGeo.scale(1, 0.72, 1)
    this.core = new THREE.Mesh(coreGeo, this.coreMaterial)
    this.core.position.z = -1.35
    this.group.add(this.core)

    // --- thrust plume -----------------------------------------------------
    const plumeGeo = new THREE.ConeGeometry(0.24, 2.6, 14, 1, true)
    plumeGeo.rotateX(Math.PI / 2) // point it backwards along -Z
    plumeGeo.translate(0, 0, -2.9)
    this.plumeMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uThrust: { value: 0.5 },
        uInner: { value: new THREE.Color('#ffffff') },
        uOuter: { value: accent.clone() },
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
        uniform float uTime;
        uniform float uThrust;
        uniform vec3 uInner;
        uniform vec3 uOuter;

        void main() {
          // vUv.y runs 0 at the tail tip to 1 at the nozzle.
          float along = vUv.y;
          float flicker = 0.82 + 0.18 * sin(uTime * 45.0 + along * 22.0);
          float fade = pow(along, 1.6) * uThrust * flicker;
          // Keep the core tinted rather than blown to white -- the camera sits
          // directly behind the nozzle, so a white core swamps the screen.
          vec3 col = mix(uOuter, uInner, pow(along, 5.0) * 0.5);
          gl_FragColor = vec4(col * (0.4 + uThrust * 0.6), fade * 0.34);
        }
      `,
    })
    this.plume = new THREE.Mesh(plumeGeo, this.plumeMaterial)
    this.group.add(this.plume)

    // --- ground glow ------------------------------------------------------
    // Sells the hover, and keeps the craft anchored to the road visually.
    // Kept small and dim: at this camera distance a large additive plane
    // swallows the hull's silhouette entirely.
    const glowGeo = new THREE.PlaneGeometry(2.8, 4.6)
    glowGeo.rotateX(-Math.PI / 2)
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.glow = new THREE.Mesh(glowGeo, this.glowMaterial)
    this.glow.position.y = -1.1
    this.group.add(this.glow)

    // Sized so the craft reads as a vehicle at the chase-camera distance
    // rather than a point of light.
    this.group.scale.setScalar(2.2)

    // --- overdrive beam ---------------------------------------------------
    // Lives in the scene rather than under the craft: the group carries a 2.2x
    // scale, and this has to be sized in true world units so its width can
    // exactly equal the collection radius.
    // Stands upright rather than lying flat. The chase camera is only ~8 units
    // above the road, so a horizontal plane is viewed almost edge-on and has
    // near-zero screen area -- vertical blades at the reach limits are the only
    // thing that actually reads from back here.
    const beamGeo = new THREE.PlaneGeometry(2, 2.6)
    beamGeo.translate(0, 0.95, 0)
    this.beamMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uColor: { value: accent.clone() },
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
        uniform float uTime;
        uniform float uStrength;
        uniform vec3 uColor;

        void main() {
          float ex = abs(vUv.x * 2.0 - 1.0); // 0 at the craft, 1 at the tips
          float up = vUv.y;                  // 0 at road level, 1 at the top

          // Vertical blades marking exactly where the reach ends -- that edge
          // is also the hazard radius, so it has to be unmissable.
          float tip = smoothstep(0.80, 0.98, ex);
          float vFade = 1.0 - pow(up, 1.7);
          float scan = 0.5 + 0.5 * sin(up * 9.0 - uTime * 7.0);

          // A faint sill along the ground ties the two blades together without
          // washing out the road between them.
          float sill = (1.0 - smoothstep(0.0, 0.14, up)) * (1.0 - pow(ex, 3.0));

          float a = (tip * (0.8 + scan * 0.45) * vFade + sill * 0.32) * uStrength;
          if (a < 0.004) discard;

          vec3 col = uColor * (0.9 + tip * 0.7) + vec3(tip * 0.45);
          gl_FragColor = vec4(col, a);
        }
      `,
    })
    this.beam = new THREE.Mesh(beamGeo, this.beamMaterial)
    this.beam.frustumCulled = false
    this.beam.renderOrder = 3
    this.beam.visible = false
    scene.add(this.beam)
    this.scene = scene
    this.beamStrength = 0

    // Steering state, in world units across the road.
    this.offset = 0
    this.velocity = 0
    this.visualRoll = 0
    this.visualPitch = 0
    this.bob = 0
  }

  /**
   * @param {number} dt        seconds
   * @param {number} steer     -1..1 input
   * @param {number} limit     max |offset| allowed
   * @param {number} speed01   0..1 normalized speed
   */
  steer(dt, steer, limit, speed01) {
    // Top speed here is ACCEL/DAMP, not MAX_V -- damping balances the input
    // long before the clamp does. ~29 u/s crosses the full 18-unit road in
    // about 0.65s, which is what it takes to react to blocks that can arrive
    // less than a tenth of a second apart. MAX_V only catches the speed bonus.
    const ACCEL = 260
    const DAMP = 9
    const MAX_V = 42

    // Handling tightens a little at speed so fast sections still feel precise.
    this.velocity += steer * ACCEL * (1 + speed01 * 0.25) * dt
    this.velocity -= this.velocity * DAMP * dt
    this.velocity = THREE.MathUtils.clamp(this.velocity, -MAX_V, MAX_V)
    this.offset += this.velocity * dt

    // Soft wall: bleed velocity instead of stopping dead.
    if (this.offset > limit) {
      this.offset = limit
      this.velocity *= -0.12
    } else if (this.offset < -limit) {
      this.offset = -limit
      this.velocity *= -0.12
    }
  }

  /**
   * Direct positional steering, used for mouse input.
   *
   * Deliberately skips the acceleration model: the entire point of mouse
   * control is that there is no top speed to run into -- the craft goes exactly
   * where you put it, as fast as you move.
   *
   * @param {number} delta  world units to move this frame
   * @param {number} dt     seconds
   * @param {number} limit  max |offset| allowed
   */
  moveBy(delta, dt, limit) {
    const previous = this.offset
    this.offset = THREE.MathUtils.clamp(this.offset + delta, -limit, limit)

    // Roll and lean key off velocity, so derive it from actual motion. Raw
    // per-frame mouse deltas are far too jittery to bank on directly, hence
    // the smoothing.
    const instant = (this.offset - previous) / Math.max(dt, 1e-4)
    this.velocity += (instant - this.velocity) * Math.min(1, dt * 14)
  }

  /**
   * Place the craft on the track and animate it.
   * @param {object} frame  a Track.sample() result
   */
  place(frame, dt, time, bass, thrust) {
    const HOVER = 1.5

    this.bob += dt * 2.4
    const bobY = Math.sin(this.bob) * 0.12 + bass * 0.22

    this.group.position
      .copy(frame.position)
      .addScaledVector(frame.right, this.offset)
      .addScaledVector(frame.up, HOVER + bobY)

    // Orient to the track, then lean into the steering.
    const m = new THREE.Matrix4().makeBasis(
      frame.right.clone(),
      frame.up.clone(),
      frame.forward.clone().negate()
    )
    this.group.quaternion.setFromRotationMatrix(m)

    // Scaled so a full-speed slide sits just at the roll limit rather than
    // pinning there through every small correction.
    const targetRoll = THREE.MathUtils.clamp(-this.velocity * 0.018, -0.55, 0.55)
    this.visualRoll += (targetRoll - this.visualRoll) * Math.min(1, dt * 9)
    const targetPitch = THREE.MathUtils.clamp(-thrust * 0.09, -0.2, 0.2)
    this.visualPitch += (targetPitch - this.visualPitch) * Math.min(1, dt * 5)

    this.group.rotateZ(this.visualRoll)
    this.group.rotateX(this.visualPitch)

    // Engine reacts to the low end -- the craft pulses with the kick.
    const pulse = 1 + bass * 0.55
    this.core.scale.setScalar(pulse)
    this.plumeMaterial.uniforms.uTime.value = time
    this.plumeMaterial.uniforms.uThrust.value = 0.3 + thrust * 0.4 + bass * 0.25
    this.glowMaterial.opacity = 0.09 + bass * 0.12
  }

  /**
   * Extend or retract the overdrive beam. Must be called after place(), since
   * it copies the craft's freshly-computed transform.
   *
   * @param {boolean} active
   * @param {number} halfWidth  the real collection radius, in world units
   */
  updateBeam(active, halfWidth, dt, time) {
    this.beamStrength += ((active ? 1 : 0) - this.beamStrength) * Math.min(1, dt * 7)

    this.beam.visible = this.beamStrength > 0.015
    if (!this.beam.visible) return

    this.beam.position.copy(this.group.position)
    this.beam.quaternion.copy(this.group.quaternion)
    // Sweeps out to full width as it engages, so activation reads as a motion
    // rather than a pop.
    this.beam.scale.set(halfWidth * this.beamStrength, 1, 1)

    this.beamMaterial.uniforms.uTime.value = time
    this.beamMaterial.uniforms.uStrength.value = this.beamStrength
  }

  setVisible(v) {
    this.group.visible = v
  }

  reset() {
    this.offset = 0
    this.velocity = 0
    this.visualRoll = 0
    this.visualPitch = 0
    this.beamStrength = 0
    this.beam.visible = false
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
    this.group.parent?.remove(this.group)
    this.beam.geometry.dispose()
    this.beamMaterial.dispose()
    this.scene.remove(this.beam)
  }
}
