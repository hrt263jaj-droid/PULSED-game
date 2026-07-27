import * as THREE from 'three'
import { LANE_WIDTH, makeFrame } from './track.js'

export const DIFFICULTIES = {
  easy: {
    label: 'Easy',
    note: '3 lanes · sparse notes · few hazards',
    lanes: 3,
    hazardRate: 0.05,
    density: 0.55,
  },
  normal: {
    label: 'Normal',
    note: '5 lanes · balanced',
    lanes: 5,
    hazardRate: 0.11,
    density: 0.75,
  },
  hard: {
    label: 'Hard',
    note: '5 lanes · every beat · dense hazards',
    lanes: 5,
    hazardRate: 0.22,
    density: 1.0,
  },
}

const HOVER = 1.9 // height above the road surface
export const COLLECT_RADIUS = LANE_WIDTH * 0.56
// Overdrive's reach. Applies to hazards as well as collectibles -- that's the
// whole bargain, and it's what turns "press when full" into a decision about
// when to spend it.
export const OVERDRIVE_RADIUS_SCALE = 2.2

// Voids, not red crystals. Colour is reserved entirely for things you want to
// collect, so a hazard can never be mistaken for a note whatever hue the song
// produces. The jagged silhouette and cold outline carry the read instead.
const HAZARD_COLOR = new THREE.Color('#06070c')
const HAZARD_RIM = '#a8bcd8'

/**
 * All collectibles and hazards for a run.
 *
 * Instance transforms are baked once at build time -- position on the track
 * never changes. Spin, bob and the collection burst are all computed in the
 * vertex shader from per-instance attributes, so updating a block's state
 * costs one float write rather than a matrix rebuild.
 */
export class Blocks {
  constructor(scene, track, songMap, palette, difficulty = DIFFICULTIES.normal) {
    this.scene = scene
    this.track = track
    this.difficulty = difficulty
    this.frame = makeFrame()

    this._plan(songMap, difficulty)
    this._buildMeshes(palette)

    this.cursor = 0
    this.collected = 0
    this.missed = 0
    this.hazardsHit = 0
    this.skipped = 0
  }

  /** Collectibles that were actually reachable this run. */
  get scoreableTotal() {
    return Math.max(0, this.total - this.skipped)
  }

  /**
   * Retire every block before `t` without scoring it. Used when the run starts
   * partway into a song -- otherwise seeking past a quiet intro resolves all
   * those blocks as misses the instant play begins.
   */
  skipTo(t) {
    while (this.cursor < this.items.length && this.items[this.cursor].t <= t) {
      const item = this.items[this.cursor]
      item.resolved = true
      if (!item.hazard) this.skipped++
      this.cursor++
    }
  }

  /** Turn onsets into placed blocks. */
  _plan(songMap, difficulty) {
    const laneCount = this.track.laneCount
    const items = []

    // Band -> lane bias: bass sits centre, treble flies wide. Gives the track
    // a legible relationship to what you're hearing.
    const laneForBand = (band, seedIdx) => {
      const centre = (laneCount - 1) / 2
      const spread = [0.15, 0.5, 0.8, 1.0][band] ?? 0.6
      // Alternate sides so consecutive hits of the same band don't stack up.
      const side = seedIdx % 2 === 0 ? 1 : -1
      const lane = centre + side * spread * centre
      return Math.round(THREE.MathUtils.clamp(lane, 0, laneCount - 1))
    }

    let kept = 0
    for (let i = 0; i < songMap.onsets.length; i++) {
      const onset = songMap.onsets[i]
      if (onset.t < 2.5) continue // grace period before the first block
      if (onset.t > songMap.duration - 0.5) continue

      // Thin the field on lower difficulties, keeping the strongest hits.
      if (difficulty.density < 1) {
        const keepThreshold = 1 - difficulty.density
        if (onset.strength < keepThreshold && (i % 3) !== 0) continue
      }

      const lane = laneForBand(onset.band, kept)
      // Hazards still favour weaker onsets so the beat itself stays
      // collectible, but as a bias rather than a hard gate. A strict
      // `strength < 0.55` cutoff rejected almost every onset on a punchy track,
      // making the actual hazard rate a small fraction of the configured one.
      const hazardChance = difficulty.hazardRate * (1.4 - onset.strength * 0.8)
      const isHazard = kept > 8 && pseudoRandom(i) < hazardChance

      items.push({
        t: onset.t,
        lane,
        band: onset.band,
        strength: onset.strength,
        hazard: isHazard,
        resolved: false,
        offset: (lane - (laneCount - 1) / 2) * LANE_WIDTH,
      })
      kept++
    }

    items.sort((a, b) => a.t - b.t)
    this.items = items
    this.total = items.filter((it) => !it.hazard).length
  }

  _buildMeshes(palette) {
    const collectibles = this.items.filter((it) => !it.hazard)
    const hazards = this.items.filter((it) => it.hazard)

    // Band colors, all pulled from the song's own palette.
    const bandColors = [
      new THREE.Color(palette.primary),
      new THREE.Color(palette.accent),
      new THREE.Color(palette.secondary),
      new THREE.Color(palette.accent).offsetHSL(0.08, 0, 0.12),
    ]

    // Smooth, glowing, upright -> reads as "take me".
    const gemGeo = new THREE.OctahedronGeometry(1.05, 0)
    this.gems = this._makeInstanced(gemGeo, collectibles, bandColors, false, palette)

    // Jagged and spiky -> reads as "don't". Silhouette does the work, not just
    // color, so it stays clear at speed and for colorblind players.
    const spikeGeo = new THREE.TetrahedronGeometry(1.5, 0)
    spikeGeo.scale(1, 1.35, 1)
    this.spikes = this._makeInstanced(spikeGeo, hazards, bandColors, true, palette)

    this.collectibleItems = collectibles
    this.hazardItems = hazards
  }

  _makeInstanced(geometry, items, bandColors, isHazard, palette) {
    const count = items.length
    const material = createBlockMaterial(isHazard, palette)
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count))
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    mesh.count = count

    const colors = new Float32Array(Math.max(1, count) * 3)
    const seeds = new Float32Array(Math.max(1, count))
    const times = new Float32Array(Math.max(1, count))
    const states = new Float32Array(Math.max(1, count)) // 0 pending, >0 = resolve time

    const pos = new THREE.Vector3()
    const matrix = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const basis = new THREE.Matrix4()

    for (let i = 0; i < count; i++) {
      const item = items[i]
      this.track.sample(item.t, this.frame)

      pos
        .copy(this.frame.position)
        .addScaledVector(this.frame.right, item.offset)
        .addScaledVector(this.frame.up, HOVER)

      basis.makeBasis(
        this.frame.right.clone(),
        this.frame.up.clone(),
        this.frame.forward.clone().negate()
      )
      quat.setFromRotationMatrix(basis)

      const s = isHazard ? 0.72 : 0.5 + item.strength * 0.42
      scale.setScalar(s)
      matrix.compose(pos, quat, scale)
      mesh.setMatrixAt(i, matrix)

      // Hazards are near-black rather than palette-tinted. Any hue at all put
      // them too close to whichever note colour the song happened to generate.
      const c = isHazard ? HAZARD_COLOR : bandColors[item.band]
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
      seeds[i] = pseudoRandom(i * 7 + 3) * Math.PI * 2
      times[i] = item.t

      item.index = i
    }

    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3))
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
    geometry.setAttribute('aTime', new THREE.InstancedBufferAttribute(times, 1))
    geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(states, 1))

    mesh.instanceMatrix.needsUpdate = true
    this.scene.add(mesh)

    mesh.userData.states = states
    mesh.userData.stateAttr = geometry.getAttribute('aState')
    return mesh
  }

  /**
   * Resolve every block the playhead has passed since the last frame.
   *
   * Because block times and vessel position are both driven by song time,
   * "did they hit it" is an exact comparison, not a physics query.
   *
   * @returns {{collected:Array, hazards:Array, missed:number}}
   */
  update(songTime, vesselOffset, radiusScale = 1) {
    const events = { collected: [], hazards: [], missed: 0 }
    const radius = COLLECT_RADIUS * radiusScale

    while (this.cursor < this.items.length && this.items[this.cursor].t <= songTime) {
      const item = this.items[this.cursor]
      this.cursor++
      if (item.resolved) continue
      item.resolved = true

      // Hazards use the same widened radius during overdrive. Sweeping a wider
      // beam has to cut both ways or there is no decision to make.
      const hit = Math.abs(vesselOffset - item.offset) < radius

      if (item.hazard) {
        if (hit) {
          this.hazardsHit++
          this._setState(this.spikes, item.index, songTime, 2)
          events.hazards.push(item)
        }
      } else if (hit) {
        this.collected++
        this._setState(this.gems, item.index, songTime, 1)
        events.collected.push(item)
      } else {
        this.missed++
        this._setState(this.gems, item.index, songTime, 3) // fade out quietly
        events.missed++
      }
    }

    // Uniform time drives spin/bob for every remaining instance.
    this.gems.material.uniforms.uTime.value = songTime
    this.spikes.material.uniforms.uTime.value = songTime
    return events
  }

  _setState(mesh, index, time, kind) {
    if (index == null) return
    // Pack both what happened and when into one float: sign encodes the kind.
    mesh.userData.states[index] = kind === 3 ? -time - 0.001 : time + kind * 10000
    mesh.userData.stateAttr.needsUpdate = true
  }

  /** Restore every block to unresolved so the song can be replayed. */
  reset() {
    this.cursor = 0
    this.collected = 0
    this.missed = 0
    this.hazardsHit = 0
    this.skipped = 0
    for (const item of this.items) item.resolved = false
    for (const mesh of [this.gems, this.spikes]) {
      if (!mesh?.userData?.states) continue
      mesh.userData.states.fill(0)
      mesh.userData.stateAttr.needsUpdate = true
    }
  }

  /** Positions used by the particle system for collection bursts. */
  positionOf(item, out = new THREE.Vector3()) {
    this.track.sample(item.t, this.frame)
    return out
      .copy(this.frame.position)
      .addScaledVector(this.frame.right, item.offset)
      .addScaledVector(this.frame.up, HOVER)
  }

  dispose() {
    for (const mesh of [this.gems, this.spikes]) {
      if (!mesh) continue
      mesh.geometry.dispose()
      mesh.material.dispose()
      this.scene.remove(mesh)
    }
  }
}

function createBlockMaterial(isHazard, palette) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uHazard: { value: isHazard ? 1 : 0 },
      uRim: { value: new THREE.Color(isHazard ? HAZARD_RIM : '#ffffff') },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSeed;
      attribute float aTime;
      attribute float aState;

      varying vec3 vColor;
      varying float vAlpha;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vBurst;

      uniform float uTime;

      mat3 rotY(float a) {
        float c = cos(a), s = sin(a);
        return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
      }

      void main() {
        vColor = aColor;

        // Decode state: 0 = pending, >0 = resolved (kind packed in), <0 = missed.
        float resolved = 0.0;
        float burst = 0.0;
        float sinceResolve = 0.0;
        if (aState > 0.5) {
          float kind = floor(aState / 10000.0);
          float when = aState - kind * 10000.0;
          sinceResolve = uTime - when;
          resolved = 1.0;
          burst = kind < 1.5 ? 1.0 : 0.6; // collected pops harder than a hazard
        } else if (aState < -0.0005) {
          sinceResolve = uTime - (-aState - 0.001);
          resolved = 1.0;
          burst = 0.0; // a miss just fades
        }

        // Collection burst. Eased so it snaps apart on contact instead of
        // drifting open, and short enough to read as a hit rather than a fade.
        float b = clamp(sinceResolve / 0.26, 0.0, 1.0);
        float grow = 1.0 - pow(1.0 - b, 3.0);

        // Idle animation, plus a hard spin kick at the moment of the pop.
        float spin = uTime * 1.5 + aSeed + (resolved > 0.5 ? grow * burst * 7.0 : 0.0);
        float bob = sin(uTime * 2.2 + aSeed) * 0.16;

        vec3 p = rotY(spin) * position;
        p.y += bob;

        if (resolved > 0.5) {
          p *= 1.0 + grow * burst * 2.9;
          vAlpha = pow(1.0 - b, 1.4);
        } else {
          vAlpha = 1.0;
        }
        // Brightest at the instant of contact, not on the way out.
        vBurst = resolved > 0.5 ? (1.0 - b) * burst : 0.0;

        // Fade in as it comes out of the fog rather than popping. Held close
        // enough that distant blocks don't pile into a noisy line on the
        // horizon.
        float ahead = aTime - uTime;
        vAlpha *= smoothstep(6.5, 4.2, ahead);

        vec4 world = instanceMatrix * vec4(p, 1.0);
        vec4 mv = modelViewMatrix * world;

        // Instance matrices are rigid (rotation + uniform scale), so the upper
        // 3x3 transforms normals correctly without an inverse-transpose.
        vNormalW = normalize(mat3(instanceMatrix) * rotY(spin) * normal);
        vViewDir = normalize(-mv.xyz);

        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec3 vColor;
      varying float vAlpha;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vBurst;

      uniform float uHazard;
      uniform vec3 uRim;

      void main() {
        if (vAlpha < 0.01) discard;

        vec3 n = normalize(vNormalW);
        // Cheap facet shading -- a fixed key direction, no lights needed.
        float facet = 0.45 + 0.55 * max(0.0, dot(n, normalize(vec3(0.4, 0.9, 0.3))));

        // Rim light does the heavy lifting for readability against nebulae.
        float rim = pow(1.0 - abs(dot(n, normalize(vViewDir))), 2.0);

        vec3 col = vColor * facet;
        // A cold, restrained outline: enough to catch the eye against a bright
        // road, not enough to look like something worth collecting.
        col += uRim * rim * (uHazard > 0.5 ? 0.85 : 0.9);

        if (uHazard > 0.5) col *= 0.9; // already near-black; don't crush it further
        else col *= 1.35; // push collectibles over the bloom threshold

        // Kept modest on purpose: this fires a few units from the camera and
        // sits well above the bloom threshold, so a large multiplier here
        // blows the whole screen out on every pickup.
        col += vColor * vBurst * 2.2;

        gl_FragColor = vec4(col, vAlpha);
      }
    `,
  })
}

/** Deterministic per-index pseudo-random in 0..1. */
function pseudoRandom(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
