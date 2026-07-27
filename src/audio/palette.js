// Derives the game's entire color world from the song's spectral character.
//
// This is the feature that makes two different songs produce visibly different
// worlds from identical code. Bass-heavy tracks land warm and deep; bright,
// airy tracks land cool and electric.

function hsl(h, s, l) {
  // h in degrees (wraps), s and l in 0..1 -> '#rrggbb'
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]

  const hex = (v) =>
    Math.round(Math.min(1, Math.max(0, v + m)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * @param {object} stats  aggregate spectral stats from analyze()
 * @returns palette of hex strings used across track, blocks, fog and particles
 */
export function derivePalette(stats) {
  const { centroid, brightness, energyVariance, bassRatio } = stats

  // Map log-scaled spectral centroid onto a hue arc.
  // ~200Hz (very bassy) -> 300deg magenta ... ~5kHz (very bright) -> 175deg cyan.
  const t = Math.min(1, Math.max(0, (Math.log2(centroid) - Math.log2(200)) / (Math.log2(5000) - Math.log2(200))))
  const hue = 300 - t * 125

  // Punchy, dynamic songs get more saturated worlds than flat ones.
  const sat = 0.55 + Math.min(0.35, energyVariance * 2.2)

  // Complementary-ish accents, offset far enough to read as distinct at speed.
  return {
    hue,
    primary: hsl(hue, sat, 0.55), // road edges, main emissive
    secondary: hsl(hue + 150, sat * 0.9, 0.5), // contrast accents, aurora
    accent: hsl(hue + 60, sat, 0.62), // collectibles, highlights
    hazard: hsl(hue + 180, 0.85, 0.45), // deliberately opposed to everything
    fog: hsl(hue + 200, 0.5, 0.04 + brightness * 0.03), // near-black, tinted
    nebulaA: hsl(hue - 25, sat * 0.8, 0.28),
    nebulaB: hsl(hue + 115, sat * 0.7, 0.22),
    // Bass-forward tracks get a heavier, warmer bloom tint.
    bloomTint: hsl(hue + (bassRatio > 0.45 ? -20 : 30), sat, 0.6),
  }
}
