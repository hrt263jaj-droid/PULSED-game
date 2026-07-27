import * as THREE from 'three'
import { makeFrame, TRACK_FPS } from '../game/track.js'

/**
 * Beat-synced architecture flanking the track.
 *
 * Everything is baked at build time into a single InstancedMesh -- one draw
 * call for the entire corridor regardless of song length. Height, colour and
 * position never change after construction; the pulse is computed per-vertex
 * from `uTime` and `uBeat`, so the CPU does nothing per frame but set two
 * uniforms.
 */

const SPACING = 0.32 // seconds of song between pillars, per side
const SIDE_GAP = 3.2 // units beyond the road edge
const BASE_DROP = 1.5 // how far below road level each pillar starts

export class Pillars {
  constructor(scene, track, songMap, palette, settings) {
    this.scene = scene
    this.settings = settings

    const spacing = SPACING / Math.max(0.2, settings.environmentDensity)
    const perSide = Math.max(1, Math.floor(songMap.duration / spacing))
    const count = perSide * 2

    // Unit box standing on its own base, so scaling y in the shader grows it
    // upward instead of from the middle.
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    geometry.translate(0, 0.5, 0)

    const heights = new Float32Array(count)
    const times = new Float32Array(count)
    const seeds = new Float32Array(count)
    const colors = new Float32Array(count * 3)

    const frame = makeFrame()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const matrix = new THREE.Matrix4()
    const basis = new THREE.Matrix4()

    const primary = new THREE.Color(palette.primary)
    const secondary = new THREE.Color(palette.secondary)
    const accent = new THREE.Color(palette.accent)
    const tint = new THREE.Color()

    const mesh = new THREE.InstancedMesh(geometry, createPillarMaterial(palette), count)
    mesh.frustumCulled = false
    mesh.renderOrder = 0

    let i = 0
    for (let s = 0; s < perSide; s++) {
      const t = s * spacing
      track.sample(t, frame)

      const energyIdx = Math.min(track.frameCount - 1, Math.round(t * TRACK_FPS))
      const energy = track.energy[energyIdx] ?? 0.4

      for (const side of [-1, 1]) {
        const r = pseudoRandom(i * 3 + 11)
        const r2 = pseudoRandom(i * 3 + 29)

        // Loud passages raise the walls -- the corridor closes in on a chorus
        // and opens out during a breakdown.
        heights[i] = 5 + energy * 26 + r * 9
        times[i] = t
        seeds[i] = r2 * Math.PI * 2

        tint.copy(r2 < 0.25 ? accent : r < 0.5 ? primary : secondary)
        colors[i * 3] = tint.r
        colors[i * 3 + 1] = tint.g
        colors[i * 3 + 2] = tint.b

        pos
          .copy(frame.position)
          .addScaledVector(frame.right, side * (track.halfWidth + SIDE_GAP + r * 5))
          .addScaledVector(frame.up, -BASE_DROP)

        basis.makeBasis(
          frame.right.clone(),
          frame.up.clone(),
          frame.forward.clone().negate()
        )
        quat.setFromRotationMatrix(basis)

        // Height lives in the attribute, not the matrix, so the shader can
        // animate it. Y scale stays 1 here.
        scale.set(0.4 + r * 0.85, 1, 0.4 + r2 * 1.0)
        matrix.compose(pos, quat, scale)
        mesh.setMatrixAt(i, matrix)
        i++
      }
    }

    geometry.setAttribute('aHeight', new THREE.InstancedBufferAttribute(heights, 1))
    geometry.setAttribute('aTime', new THREE.InstancedBufferAttribute(times, 1))
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3))
    mesh.instanceMatrix.needsUpdate = true

    const u = mesh.material.uniforms
    u.uFogFar.value = settings.environmentDistance * 0.85
    u.uFogNear.value = settings.environmentDistance * 0.2

    this.mesh = mesh
    scene.add(mesh)
  }

  /**
   * @param {number} songTime
   * @param {number} beat  0..1, decaying after each detected onset
   * @param {number} bass  0..1
   */
  update(songTime, beat, bass) {
    const u = this.mesh.material.uniforms
    u.uTime.value = songTime
    u.uBeat.value = beat
    u.uBass.value = bass
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.scene.remove(this.mesh)
  }
}

function createPillarMaterial(palette) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uBass: { value: 0 },
      uFogColor: { value: new THREE.Color(palette.fog) },
      uFogNear: { value: 120 },
      uFogFar: { value: 500 },
    },
    vertexShader: /* glsl */ `
      attribute float aHeight;
      attribute float aTime;
      attribute float aSeed;
      attribute vec3 aColor;

      varying vec3 vColor;
      varying float vUp;
      varying float vPulse;
      varying float vFogDepth;

      uniform float uTime;
      uniform float uBeat;
      uniform float uBass;

      void main() {
        vColor = aColor;
        vUp = position.y; // 0 at the base, 1 at the top

        // Only pillars near the playhead react, so the pulse travels with you
        // instead of the whole corridor strobing at once.
        float near = exp(-abs(aTime - uTime) * 0.5);
        vPulse = uBeat * near + uBass * near * 0.45;

        vec3 p = position;
        p.y *= aHeight * (1.0 + vPulse * 0.28);

        vec4 world = instanceMatrix * vec4(p, 1.0);
        vec4 mv = modelViewMatrix * world;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec3 vColor;
      varying float vUp;
      varying float vPulse;
      varying float vFogDepth;

      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;

      void main() {
        // Bright at the base, dissolving toward the top, so they read as light
        // rising out of the dark rather than as solid blocks.
        float body = pow(1.0 - vUp, 1.8);
        float glow = body * (0.30 + vPulse * 1.5);

        vec3 col = vColor * glow;
        col += vColor * vPulse * 0.35;

        float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
        col = mix(col, uFogColor, fog);

        // Fade out anything close to the lens. Pillars level with the camera
        // are only a few units away and would otherwise fill half the screen
        // as slabs of colour.
        float nearFade = smoothstep(7.0, 30.0, vFogDepth);

        float alpha = (0.20 + body * 0.75 + vPulse * 0.35) * (1.0 - fog) * nearFade;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  })
}

function pseudoRandom(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
