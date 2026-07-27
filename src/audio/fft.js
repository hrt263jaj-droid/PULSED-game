// Iterative radix-2 Cooley-Tukey FFT.
//
// Written by hand rather than pulled from a library because it runs a few
// thousand times per song and we want zero allocation inside the loop --
// every buffer here is allocated once in the constructor and reused.

export class FFT {
  constructor(size) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two')

    this.size = size
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)

    // Bit-reversal permutation table. The algorithm needs its input in
    // bit-reversed order; precomputing the mapping saves doing it per frame.
    const bits = Math.log2(size)
    this.rev = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
      this.rev[i] = r
    }

    // Twiddle factors: e^(-2*pi*i*k/N), precomputed for every k we'll need.
    this.cos = new Float64Array(size / 2)
    this.sin = new Float64Array(size / 2)
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size)
    }
  }

  /**
   * Real-input forward transform, writing magnitudes into `out`.
   * @param {Float32Array} input  length === size, already windowed
   * @param {Float32Array} out    length === size / 2
   */
  magnitudes(input, out) {
    const { size, re, im, rev, cos, sin } = this

    for (let i = 0; i < size; i++) {
      re[i] = input[rev[i]]
      im[i] = 0
    }

    // Butterfly passes: combine transforms of length `half` into length `len`.
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1
      const step = size / len
      for (let i = 0; i < size; i += len) {
        for (let j = 0; j < half; j++) {
          const k = j * step
          const c = cos[k]
          const s = sin[k]
          const a = i + j
          const b = a + half
          const tr = re[b] * c - im[b] * s
          const ti = re[b] * s + im[b] * c
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }

    // Only the first half is meaningful for real input (the rest mirrors it).
    for (let i = 0; i < size / 2; i++) {
      out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i])
    }
  }
}

/** Hann window -- tapers each frame's edges so the FFT doesn't see a hard cut. */
export function hannWindow(size) {
  const w = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
  }
  return w
}
