import { FFT, hannWindow } from './fft.js'
import { derivePalette } from './palette.js'

// Analysis resolution. 2048 @ 44.1kHz is ~46ms of audio per frame, hopping
// every 512 samples gives ~86 frames/sec -- fine enough to catch hi-hats,
// coarse enough that a 5-minute song analyzes in a couple of seconds.
const FFT_SIZE = 2048
const HOP = 512

const BANDS = [
  ['bass', 20, 250],
  ['lowMid', 250, 800],
  ['mid', 800, 2500],
  ['treble', 2500, 10000],
]

const MIN_ONSET_GAP = 0.085 // seconds; below this it's the same hit

/** Value at a given percentile of an array (used to normalize per-song). */
function percentile(arr, p) {
  const sorted = Float32Array.from(arr).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 1
}

/**
 * Turn raw PCM into a complete gameplay timeline.
 *
 * Everything downstream -- track shape, block placement, color, speed -- is
 * generated from the SongMap this returns. Nothing reads the audio again at
 * play time except the playhead clock.
 *
 * @param {Float32Array} pcm    mono mixdown
 * @param {number} sampleRate
 * @param {(p:number)=>void} onProgress  0..1
 */
export function analyze(pcm, sampleRate, onProgress = () => {}) {
  const fft = new FFT(FFT_SIZE)
  const win = hannWindow(FFT_SIZE)
  const frameBuf = new Float32Array(FFT_SIZE)
  const mag = new Float32Array(FFT_SIZE / 2)
  const prevMag = new Float32Array(FFT_SIZE / 2)

  const binHz = sampleRate / FFT_SIZE
  const bands = BANDS.map(([name, lo, hi]) => ({
    name,
    lo: Math.max(1, Math.floor(lo / binHz)),
    hi: Math.min(FFT_SIZE / 2 - 1, Math.ceil(hi / binHz)),
  }))

  const frameCount = Math.max(1, Math.floor((pcm.length - FFT_SIZE) / HOP))
  const framesPerSec = sampleRate / HOP
  const duration = pcm.length / sampleRate

  // Raw per-frame features, normalized in a second pass.
  const rms = new Float32Array(frameCount)
  const flux = new Float32Array(frameCount)
  const bandEnergy = bands.map(() => new Float32Array(frameCount))
  const bandFlux = bands.map(() => new Float32Array(frameCount))
  const centroidPerFrame = new Float32Array(frameCount)

  for (let f = 0; f < frameCount; f++) {
    const offset = f * HOP

    let sumSq = 0
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = pcm[offset + i]
      sumSq += s * s
      frameBuf[i] = s * win[i]
    }
    rms[f] = Math.sqrt(sumSq / FFT_SIZE)

    fft.magnitudes(frameBuf, mag)

    // Spectral flux: total positive change since the last frame. Rising energy
    // means something new started -- that's an onset candidate.
    let totalFlux = 0
    for (let i = 1; i < mag.length; i++) {
      const d = mag[i] - prevMag[i]
      if (d > 0) totalFlux += d
    }
    flux[f] = totalFlux

    // Energy-weighted mean frequency. Drives the palette.
    let weighted = 0
    let total = 0
    for (let i = 1; i < mag.length; i++) {
      weighted += mag[i] * i * binHz
      total += mag[i]
    }
    centroidPerFrame[f] = total > 0 ? weighted / total : 0

    for (let b = 0; b < bands.length; b++) {
      const { lo, hi } = bands[b]
      let energy = 0
      let bFlux = 0
      for (let i = lo; i <= hi; i++) {
        energy += mag[i]
        const d = mag[i] - prevMag[i]
        if (d > 0) bFlux += d
      }
      const width = hi - lo + 1
      bandEnergy[b][f] = energy / width
      bandFlux[b][f] = bFlux / width
    }

    prevMag.set(mag)

    if ((f & 255) === 0) onProgress(f / frameCount)
  }

  // --- Normalize per song ------------------------------------------------
  // A quiet acoustic track and a brickwalled master should both use the full
  // gameplay range, so scale against each song's own 95th percentile.
  const normalize = (arr) => {
    const scale = percentile(arr, 0.95)
    const out = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i++) out[i] = Math.min(1.6, arr[i] / scale)
    return out
  }

  const nRms = normalize(rms)
  const nFlux = normalize(flux)
  const nBandEnergy = bandEnergy.map(normalize)
  const nBandFlux = bandFlux.map(normalize)

  onProgress(0.9)

  // --- Onset detection ---------------------------------------------------
  const onsets = detectOnsets(nFlux, nBandFlux, framesPerSec)

  // --- Tempo -------------------------------------------------------------
  const bpm = estimateBpm(nFlux, framesPerSec)

  // --- Coarse structure (for environment intensity tiers) ----------------
  const sections = buildSections(nRms, framesPerSec)

  // --- Aggregate stats for the palette -----------------------------------
  let centroidSum = 0
  let centroidWeight = 0
  let rmsMean = 0
  for (let f = 0; f < frameCount; f++) {
    centroidSum += centroidPerFrame[f] * nRms[f]
    centroidWeight += nRms[f]
    rmsMean += nRms[f]
  }
  rmsMean /= frameCount
  let variance = 0
  for (let f = 0; f < frameCount; f++) variance += (nRms[f] - rmsMean) ** 2
  variance = Math.sqrt(variance / frameCount)

  const bandMeans = nBandEnergy.map((arr) => {
    let s = 0
    for (let i = 0; i < arr.length; i++) s += arr[i]
    return s / arr.length
  })
  const bandTotal = bandMeans.reduce((a, b) => a + b, 0) || 1

  const palette = derivePalette({
    centroid: centroidWeight > 0 ? centroidSum / centroidWeight : 1200,
    brightness: bandMeans[3] / bandTotal,
    bassRatio: bandMeans[0] / bandTotal,
    energyVariance: variance,
  })

  // Where the song actually gets going. Used to offer skipping long ambient
  // lead-ins, which otherwise mean crawling uphill through an empty track.
  let introEnd = 0
  for (let f = 0; f < frameCount; f++) {
    if (nRms[f] > 0.35) {
      introEnd = Math.max(0, f / framesPerSec - 1.5)
      break
    }
  }

  onProgress(1)

  return {
    duration,
    sampleRate,
    introEnd,
    bpm,
    framesPerSec,
    frameCount,
    rms: nRms,
    flux: nFlux,
    bands: {
      bass: nBandEnergy[0],
      lowMid: nBandEnergy[1],
      mid: nBandEnergy[2],
      treble: nBandEnergy[3],
    },
    onsets,
    sections,
    palette,
    // Downsampled envelope for the results-screen graph.
    envelope: downsample(nRms, 400),
  }
}

/**
 * Peak-picking with an adaptive local threshold. A fixed threshold either
 * floods quiet passages with blocks or starves loud ones; comparing each frame
 * against its own neighbourhood keeps density roughly even across the song.
 */
function detectOnsets(flux, bandFlux, framesPerSec) {
  const onsets = []
  const window = Math.round(framesPerSec * 0.2) // +/- 200ms
  const minGap = Math.round(framesPerSec * MIN_ONSET_GAP)
  let lastOnset = -Infinity

  for (let f = 1; f < flux.length - 1; f++) {
    // Must be a local peak at all.
    if (flux[f] <= flux[f - 1] || flux[f] < flux[f + 1]) continue

    let sum = 0
    let count = 0
    for (let i = Math.max(0, f - window); i <= Math.min(flux.length - 1, f + window); i++) {
      sum += flux[i]
      count++
    }
    const threshold = (sum / count) * 1.45 + 0.03
    if (flux[f] < threshold) continue
    if (f - lastOnset < minGap) continue

    // Which band drove this hit? Decides lane and color downstream.
    let band = 0
    let best = -1
    for (let b = 0; b < bandFlux.length; b++) {
      if (bandFlux[b][f] > best) {
        best = bandFlux[b][f]
        band = b
      }
    }

    onsets.push({
      t: f / framesPerSec,
      frame: f,
      band,
      strength: Math.min(1, flux[f]),
    })
    lastOnset = f
  }

  return onsets
}

/** Autocorrelation of the flux signal over musically plausible lags. */
function estimateBpm(flux, framesPerSec) {
  const minLag = Math.floor((60 / 200) * framesPerSec)
  const maxLag = Math.ceil((60 / 60) * framesPerSec)
  let bestLag = minLag
  let bestScore = -Infinity

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0
    for (let i = 0; i + lag < flux.length; i++) score += flux[i] * flux[i + lag]
    score /= flux.length - lag
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  return (60 * framesPerSec) / bestLag
}

/** Coarse energy tiers, one every ~2s, smoothed over ~4s. */
function buildSections(rms, framesPerSec) {
  const step = Math.round(framesPerSec * 2)
  const half = Math.round(framesPerSec * 2)
  const sections = []

  for (let f = 0; f < rms.length; f += step) {
    let sum = 0
    let count = 0
    for (let i = Math.max(0, f - half); i < Math.min(rms.length, f + half); i++) {
      sum += rms[i]
      count++
    }
    sections.push({ t: f / framesPerSec, intensity: count ? sum / count : 0 })
  }

  return sections
}

function downsample(arr, targetLength) {
  const out = new Float32Array(targetLength)
  const bucket = arr.length / targetLength
  for (let i = 0; i < targetLength; i++) {
    const start = Math.floor(i * bucket)
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket))
    let peak = 0
    for (let j = start; j < end && j < arr.length; j++) peak = Math.max(peak, arr[j])
    out[i] = peak
  }
  return out
}
