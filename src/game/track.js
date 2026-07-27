import * as THREE from 'three'

// --- Tuning ----------------------------------------------------------------
export const TRACK_FPS = 60 // track samples per second of song
export const LANE_WIDTH = 3.6

// Slow macro terrain from overall song energy -- this is what makes big tall
// hills. Kept low deliberately: the ride's character comes from BASS_DIP's fast
// undulation, and a large value here just buries that under one huge landmass.
const HEIGHT_SCALE = 20
// How hard each bass transient dips the road. This is the rollercoaster dial:
// raise for a wilder ride, drop toward 0 for smooth rolling terrain.
// Sized to stay mostly *below* the gradient clamp. When this saturates the
// clamp the bumps stop being hills and become triangular max-slope ramps.
const BASS_DIP = 16
const BASE_SPEED = 58 // units/sec on flat ground
const SLOPE_GAIN = 0.9 // how hard gradient pushes the speed around
// Hard ceiling on gradient, as a ratio of vertical rise to forward travel.
// Without this a sharp energy jump produces a near-vertical segment, the
// road's orientation frame degenerates against world-up, and the ribbon folds
// through itself.
const MAX_GRADIENT = 0.42
const MIN_SPEED = 34
const MAX_SPEED = 132
const TURN_STRENGTH = 0.55 // radians of heading swing
const BANK_GAIN = 2.6

/**
 * THE CENTRAL DESIGN DECISION OF THIS FILE:
 *
 * The track is parameterized by *song time*, not by distance. Frame `i` is
 * always the geometry at t = i / TRACK_FPS, so a block detected at 41.3s is
 * placed at exactly the point the vessel occupies at 41.3s. Audio and geometry
 * can never drift apart, and no physics integration is needed at play time.
 *
 * Speed is emergent rather than simulated: fast passages simply have their
 * sample points spaced further apart, so travelling one frame per 1/60s covers
 * more ground. That's the Audiosurf trick.
 *
 * Elevation is INVERTED energy -- loud sections sit low, so a chorus is a
 * plunge that speeds you up, and a breakdown is a climb that slows you down.
 */

function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic seed so the same song always builds the same track. */
function seedFromSong(songMap) {
  let h = 2166136261
  const mix = (v) => {
    h ^= Math.round(v * 1000) | 0
    h = Math.imul(h, 16777619)
  }
  mix(songMap.duration)
  mix(songMap.bpm)
  for (let i = 0; i < Math.min(48, songMap.onsets.length); i++) mix(songMap.onsets[i].t)
  return h >>> 0
}

/** Box-smooth an array over +/- radius samples. */
function smooth(arr, radius) {
  const out = new Float32Array(arr.length)
  let sum = 0
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i]
    if (i > 2 * radius) sum -= arr[i - 2 * radius - 1]
    const count = Math.min(i + 1, 2 * radius + 1)
    out[Math.max(0, i - radius)] = sum / count
  }
  // Tail: the loop above leaves the last `radius` entries unwritten.
  for (let i = arr.length - radius; i < arr.length; i++) out[i] = out[arr.length - radius - 1]
  return out
}

/** Resample a per-analysis-frame array onto the track's own frame rate. */
function resample(arr, srcFps, dstFps, dstLength) {
  const out = new Float32Array(dstLength)
  const ratio = srcFps / dstFps
  for (let i = 0; i < dstLength; i++) {
    const p = i * ratio
    const a = Math.min(arr.length - 1, Math.floor(p))
    const b = Math.min(arr.length - 1, a + 1)
    const f = p - a
    out[i] = arr[a] * (1 - f) + arr[b] * f
  }
  return out
}

export class Track {
  constructor(songMap, laneCount = 5) {
    this.songMap = songMap
    this.laneCount = laneCount
    this.halfWidth = (laneCount * LANE_WIDTH) / 2
    this.frameCount = Math.max(2, Math.ceil(songMap.duration * TRACK_FPS) + TRACK_FPS)

    this._build()
    this._buildGeometry()
  }

  _build() {
    const n = this.frameCount
    const dt = 1 / TRACK_FPS

    // Heavily smoothed energy -- rolling hills, not jitter.
    const energyRaw = resample(this.songMap.rms, this.songMap.framesPerSec, TRACK_FPS, n)
    const energy = smooth(energyRaw, Math.round(TRACK_FPS * 0.95))
    const midRaw = resample(this.songMap.bands.mid, this.songMap.framesPerSec, TRACK_FPS, n)
    const mid = smooth(midRaw, Math.round(TRACK_FPS * 1.2))

    // Rollercoaster term. A fast bass envelope measured against a slow one
    // isolates each *hit* from the sustained low end -- a constant bass drone
    // shouldn't ripple the whole track, but every kick should punch a dip into
    // it. Dips rather than crests, so you accelerate into each hit, which keeps
    // it consistent with loud-sits-low.
    const bassRaw = resample(this.songMap.bands.bass, this.songMap.framesPerSec, TRACK_FPS, n)
    const bassFast = smooth(bassRaw, Math.round(TRACK_FPS * 0.1))
    const bassSlow = smooth(bassRaw, Math.round(TRACK_FPS * 0.85))

    // Heading is driven directly (not integrated as curvature) so the track
    // meanders without ever spiraling off into a loop.
    const rng = mulberry32(seedFromSong(this.songMap))
    const layers = [
      { freq: 0.031, amp: 1.0, phase: rng() * Math.PI * 2 },
      { freq: 0.079, amp: 0.46, phase: rng() * Math.PI * 2 },
      { freq: 0.163, amp: 0.19, phase: rng() * Math.PI * 2 },
    ]

    const positions = new Float32Array(n * 3)
    const rights = new Float32Array(n * 3)
    const ups = new Float32Array(n * 3)
    const forwards = new Float32Array(n * 3)
    const speeds = new Float32Array(n)
    const banks = new Float32Array(n)
    const heights = new Float32Array(n)

    // Elevation and heading are pure functions of time -- compute up front.
    const headings = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i * dt
      heights[i] = (0.5 - energy[i]) * HEIGHT_SCALE - (bassFast[i] - bassSlow[i]) * BASS_DIP

      let h = 0
      for (const l of layers) h += Math.sin(t * l.freq * Math.PI * 2 + l.phase) * l.amp
      // Busier passages wind more.
      headings[i] = h * TURN_STRENGTH * (0.55 + mid[i] * 0.75)
    }

    // Clamp the gradient in both directions. A single forward pass would push
    // every violation downhill and skew the whole track, so sweep back as well.
    const maxDelta = MAX_GRADIENT * BASE_SPEED * dt
    for (let i = 1; i < n; i++) {
      heights[i] = THREE.MathUtils.clamp(heights[i], heights[i - 1] - maxDelta, heights[i - 1] + maxDelta)
    }
    for (let i = n - 2; i >= 0; i--) {
      heights[i] = THREE.MathUtils.clamp(heights[i], heights[i + 1] - maxDelta, heights[i + 1] + maxDelta)
    }
    // Clamping leaves sharp corners where a ramp meets the unclamped curve,
    // which show up as terraced steps along the road's silhouette. Round them.
    //
    // Kept short deliberately: this is a box filter, so a 0.25s radius spans
    // half a second and would erase the bass bumps entirely at any tempo above
    // ~120bpm. Just enough to take the corners off.
    heights.set(smooth(heights, Math.round(TRACK_FPS * 0.07)))

    // Walk the path forward, stepping by the local speed.
    let x = 0
    let z = 0
    for (let i = 0; i < n; i++) {
      const slope = (heights[Math.min(n - 1, i + 1)] - heights[Math.max(0, i - 1)]) / (2 * dt)
      const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, BASE_SPEED - slope * SLOPE_GAIN))
      speeds[i] = speed

      positions[i * 3] = x
      positions[i * 3 + 1] = heights[i]
      positions[i * 3 + 2] = z

      const theta = headings[i]
      x += Math.sin(theta) * speed * dt
      z += Math.cos(theta) * speed * dt

      const dTheta = (headings[Math.min(n - 1, i + 1)] - headings[Math.max(0, i - 1)]) / (2 * dt)
      banks[i] = THREE.MathUtils.clamp(-dTheta * BANK_GAIN, -0.5, 0.5)
    }

    // Bank saturates at its clamp for long stretches and then flips sign when
    // the turn reverses; smoothing keeps that transition from kinking the road.
    banks.set(smooth(banks, Math.round(TRACK_FPS * 0.35)))

    // Build the orientation frame at each sample from the actual 3D path.
    const tangent = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    const worldUp = new THREE.Vector3(0, 1, 0)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()

    for (let i = 0; i < n; i++) {
      const prev = Math.max(0, i - 1)
      const next = Math.min(n - 1, i + 1)
      a.fromArray(positions, next * 3)
      b.fromArray(positions, prev * 3)
      tangent.subVectors(a, b).normalize()
      if (tangent.lengthSq() < 0.5) tangent.set(0, 0, 1)

      // Reference-up framing rather than true Frenet frames: no torsion flips,
      // and the road never rolls upside-down on a steep crest.
      right.crossVectors(tangent, worldUp).normalize()
      up.crossVectors(right, tangent).normalize()

      // Roll into turns.
      const roll = banks[i]
      right.applyAxisAngle(tangent, roll)
      up.applyAxisAngle(tangent, roll)

      right.toArray(rights, i * 3)
      up.toArray(ups, i * 3)
      tangent.toArray(forwards, i * 3)
    }

    this.positions = positions
    this.rights = rights
    this.ups = ups
    this.forwards = forwards
    this.speeds = speeds
    this.banks = banks
    this.energy = energy
    this.maxSpeed = MAX_SPEED
    this.baseSpeed = BASE_SPEED
  }

  /**
   * Road surface as a single ribbon. Lane dividers, edge glow and the energy
   * pulse are all drawn in the fragment shader from the UVs, so the whole road
   * stays one mesh and one draw call regardless of song length.
   */
  _buildGeometry() {
    const n = this.frameCount
    const verts = new Float32Array(n * 2 * 3)
    const uvs = new Float32Array(n * 2 * 2)
    const energies = new Float32Array(n * 2)
    const indices = new Uint32Array((n - 1) * 6)

    const p = new THREE.Vector3()
    const r = new THREE.Vector3()

    for (let i = 0; i < n; i++) {
      p.fromArray(this.positions, i * 3)
      r.fromArray(this.rights, i * 3)

      const t = i / TRACK_FPS
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1
        const vi = (i * 2 + side) * 3
        verts[vi] = p.x + r.x * this.halfWidth * sign
        verts[vi + 1] = p.y + r.y * this.halfWidth * sign
        verts[vi + 2] = p.z + r.z * this.halfWidth * sign

        const ui = (i * 2 + side) * 2
        uvs[ui] = side // 0 = left edge, 1 = right edge
        uvs[ui + 1] = t // seconds along the song

        energies[i * 2 + side] = this.energy[i]
      }
    }

    for (let i = 0; i < n - 1; i++) {
      const o = i * 6
      const a = i * 2
      indices[o] = a
      indices[o + 1] = a + 1
      indices[o + 2] = a + 2
      indices[o + 3] = a + 1
      indices[o + 4] = a + 3
      indices[o + 5] = a + 2
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setAttribute('aEnergy', new THREE.BufferAttribute(energies, 1))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeBoundingSphere()

    this.geometry = geometry
  }

  /** Total song time the track covers. */
  get duration() {
    return this.frameCount / TRACK_FPS
  }

  /**
   * Interpolated track frame at song time `t`.
   * @param {number} t seconds
   * @param {{position:THREE.Vector3, right:THREE.Vector3, up:THREE.Vector3, forward:THREE.Vector3}} out
   */
  sample(t, out) {
    const n = this.frameCount
    const p = THREE.MathUtils.clamp(t * TRACK_FPS, 0, n - 1)
    const i = Math.floor(p)
    const j = Math.min(n - 1, i + 1)
    const f = p - i

    lerpInto(out.position, this.positions, i, j, f)
    lerpInto(out.right, this.rights, i, j, f)
    lerpInto(out.up, this.ups, i, j, f)
    lerpInto(out.forward, this.forwards, i, j, f)
    out.right.normalize()
    out.up.normalize()
    out.forward.normalize()

    out.speed = this.speeds[i] * (1 - f) + this.speeds[j] * f
    out.bank = this.banks[i] * (1 - f) + this.banks[j] * f
    out.energy = this.energy[i] * (1 - f) + this.energy[j] * f
    return out
  }

  /** World position of a lane centre at song time `t`. */
  lanePosition(t, lane, out = new THREE.Vector3(), scratch = makeFrame()) {
    this.sample(t, scratch)
    const offset = (lane - (this.laneCount - 1) / 2) * LANE_WIDTH
    return out.copy(scratch.position).addScaledVector(scratch.right, offset)
  }

  dispose() {
    this.geometry?.dispose()
  }
}

function lerpInto(vec, arr, i, j, f) {
  vec.set(
    arr[i * 3] * (1 - f) + arr[j * 3] * f,
    arr[i * 3 + 1] * (1 - f) + arr[j * 3 + 1] * f,
    arr[i * 3 + 2] * (1 - f) + arr[j * 3 + 2] * f
  )
}

/** Reusable container for sample() so the render loop allocates nothing. */
export function makeFrame() {
  return {
    position: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    speed: 0,
    bank: 0,
    energy: 0,
  }
}
