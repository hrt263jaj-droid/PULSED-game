/**
 * A synthesized demo track, so the game has something to show before the
 * player has committed a file to it.
 *
 * It's written with a deliberate energy arc -- intro, build, drop, breakdown,
 * final drop -- because the track generator turns loudness into elevation.
 * A flat loop would produce a flat, boring road.
 */

const BPM = 128
const BARS = 24
const SECONDS_PER_BEAT = 60 / BPM
const DURATION = BARS * 4 * SECONDS_PER_BEAT // ~45s

// Energy per bar, 0..1. This is the shape the road will take.
const ARC = [
  0.18, 0.22, 0.3, 0.36, // intro
  0.45, 0.55, 0.68, 0.85, // build
  1.0, 0.95, 1.0, 0.92, // drop
  0.95, 1.0, 0.9, 0.5, // drop tail
  0.28, 0.22, 0.35, 0.5, // breakdown
  0.8, 1.0, 0.95, 0.6, // final drop + outro
]

// Simple minor progression, semitones from A.
const ROOTS = [0, -4, -7, -5]

const noteHz = (semitones) => 110 * Math.pow(2, semitones / 12)

function energyAt(bar) {
  return ARC[Math.min(ARC.length - 1, Math.max(0, bar))] ?? 0.5
}

/**
 * @param {AudioContext} ctx
 * @returns {AudioBuffer}
 */
export function createDemoTrack(ctx) {
  const sampleRate = ctx.sampleRate
  const length = Math.ceil(DURATION * sampleRate)
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const out = buffer.getChannelData(0)

  const totalBeats = BARS * 4
  let noiseState = 12345

  // Cheap deterministic noise so the demo sounds identical every time.
  const noise = () => {
    noiseState = (noiseState * 1103515245 + 12345) & 0x7fffffff
    return (noiseState / 0x3fffffff) - 1
  }

  const add = (startSec, durSec, fn) => {
    const start = Math.floor(startSec * sampleRate)
    const count = Math.floor(durSec * sampleRate)
    for (let i = 0; i < count; i++) {
      const idx = start + i
      if (idx < 0 || idx >= length) continue
      out[idx] += fn(i / sampleRate, i / count)
    }
  }

  for (let beat = 0; beat < totalBeats; beat++) {
    const t = beat * SECONDS_PER_BEAT
    const bar = Math.floor(beat / 4)
    const beatInBar = beat % 4
    const e = energyAt(bar)
    const root = ROOTS[bar % ROOTS.length]

    // --- kick: every beat once we're past the intro ----------------------
    if (e > 0.25) {
      add(t, 0.32, (s) => {
        const env = Math.exp(-s * 16)
        // Pitch sweep from 130Hz down to ~45Hz gives it a real thump.
        const f = 45 + 85 * Math.exp(-s * 32)
        return Math.sin(2 * Math.PI * f * s) * env * 0.85 * (0.5 + e * 0.5)
      })
    }

    // --- snare on 2 and 4 -------------------------------------------------
    if (beatInBar % 2 === 1 && e > 0.4) {
      add(t, 0.18, (s) => {
        const env = Math.exp(-s * 26)
        const body = Math.sin(2 * Math.PI * 190 * s) * 0.35
        return (noise() * 0.7 + body) * env * 0.42 * e
      })
    }

    // --- hats on eighths --------------------------------------------------
    for (let half = 0; half < 2; half++) {
      if (e < 0.3) continue
      const ht = t + half * SECONDS_PER_BEAT * 0.5
      const accent = half === 0 ? 1 : 0.55
      add(ht, 0.06, (s) => {
        const env = Math.exp(-s * 90)
        return noise() * env * 0.16 * accent * e
      })
    }

    // --- bass: eighth-note pulse -----------------------------------------
    if (e > 0.3) {
      for (let half = 0; half < 2; half++) {
        const bt = t + half * SECONDS_PER_BEAT * 0.5
        const f = noteHz(root - 12)
        add(bt, SECONDS_PER_BEAT * 0.48, (s, p) => {
          const env = Math.min(1, p * 14) * Math.exp(-s * 6)
          // Saw-ish: fundamental plus a couple of harmonics.
          return (
            (Math.sin(2 * Math.PI * f * s) +
              Math.sin(4 * Math.PI * f * s) * 0.38 +
              Math.sin(6 * Math.PI * f * s) * 0.18) *
            env *
            0.3 *
            e
          )
        })
      }
    }

    // --- chord stab on the downbeat --------------------------------------
    if (beatInBar === 0 && e > 0.45) {
      const chord = [root, root + 3, root + 7, root + 12]
      add(t, SECONDS_PER_BEAT * 1.6, (s, p) => {
        const env = Math.min(1, p * 30) * Math.exp(-s * 3.2)
        let v = 0
        for (const semi of chord) {
          const f = noteHz(semi + 12)
          v += Math.sin(2 * Math.PI * f * s)
        }
        return (v / chord.length) * env * 0.2 * e
      })
    }

    // --- lead arpeggio in the drops ---------------------------------------
    if (e > 0.85) {
      for (let sixteenth = 0; sixteenth < 4; sixteenth++) {
        const lt = t + sixteenth * SECONDS_PER_BEAT * 0.25
        const semi = root + 24 + [0, 7, 3, 12][(beat + sixteenth) % 4]
        const f = noteHz(semi)
        add(lt, SECONDS_PER_BEAT * 0.22, (s, p) => {
          const env = Math.min(1, p * 20) * Math.exp(-s * 14)
          return (
            (Math.sin(2 * Math.PI * f * s) + Math.sin(4 * Math.PI * f * s) * 0.3) *
            env *
            0.13
          )
        })
      }
    }
  }

  // Soft-clip to keep it inside [-1, 1] without hard distortion.
  for (let i = 0; i < length; i++) {
    out[i] = Math.tanh(out[i] * 1.1)
  }

  return buffer
}

export const DEMO_NAME = 'Demo — Pulsedrive Theme'
