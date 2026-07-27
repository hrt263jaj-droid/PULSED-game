// Graphics tiers. Defaults to `high` -- this is a visual-spectacle game and
// playing it safe would undersell it -- but every knob is exposed so weaker
// machines have a real dial rather than an automatic downgrade they can't
// argue with.

export const TIERS = {
  low: {
    label: 'Low',
    note: 'No bloom. Integrated graphics.',
    maxPixelRatio: 1,
    antialias: false,
    bloom: false,
    bloomStrength: 0,
    bloomResolutionScale: 0.5,
    grade: false,
    particleScale: 0.2,
    nebulaLayers: 0,
    starCount: 1200,
    environmentDistance: 260,
    environmentDensity: 0.35,
    tesseractSteps: 0, // raymarching is the single most expensive thing here
  },
  medium: {
    label: 'Medium',
    note: 'Bloom at half resolution.',
    maxPixelRatio: 1.25,
    antialias: false,
    bloom: true,
    bloomStrength: 0.55,
    bloomResolutionScale: 0.5,
    grade: true,
    particleScale: 0.5,
    nebulaLayers: 2,
    starCount: 2600,
    environmentDistance: 380,
    environmentDensity: 0.6,
    tesseractSteps: 32,
  },
  high: {
    label: 'High',
    note: 'Recommended. Full effect stack.',
    maxPixelRatio: 1.75,
    antialias: true,
    bloom: true,
    bloomStrength: 0.8,
    bloomResolutionScale: 0.75,
    grade: true,
    particleScale: 1,
    nebulaLayers: 3,
    starCount: 5000,
    environmentDistance: 520,
    environmentDensity: 1,
    tesseractSteps: 48,
  },
  ultra: {
    label: 'Ultra',
    note: 'Everything on. Wants a real GPU.',
    maxPixelRatio: 2,
    antialias: true,
    bloom: true,
    bloomStrength: 1.0,
    bloomResolutionScale: 1,
    grade: true,
    particleScale: 1.6,
    nebulaLayers: 4,
    starCount: 9000,
    environmentDistance: 680,
    environmentDensity: 1.4,
    tesseractSteps: 64, // Fable's original count
  },
}

const STORAGE_KEY = 'pulsedrive.quality'
const DEFAULT_TIER = 'high'

export function loadTier() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && TIERS[saved]) return saved
  } catch {
    // localStorage can throw in private mode; the default is fine.
  }
  return DEFAULT_TIER
}

export function saveTier(name) {
  try {
    localStorage.setItem(STORAGE_KEY, name)
  } catch {
    // Non-fatal: the setting just won't persist.
  }
}

export function getSettings(name) {
  return TIERS[name] ?? TIERS[DEFAULT_TIER]
}

// --- mouse sensitivity, in world units per pixel of mouse movement ---------
// At the default, sweeping the full width of the road takes ~460px of travel.

const SENS_KEY = 'pulsedrive.sensitivity'
export const DEFAULT_SENSITIVITY = 0.035

export function loadSensitivity() {
  try {
    const saved = parseFloat(localStorage.getItem(SENS_KEY))
    if (Number.isFinite(saved) && saved > 0) return saved
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_SENSITIVITY
}

export function saveSensitivity(value) {
  try {
    localStorage.setItem(SENS_KEY, String(value))
  } catch {
    // Non-fatal: the setting just won't persist.
  }
}

// --- gameplay preferences --------------------------------------------------

const DIFFICULTY_KEY = 'pulsedrive.difficulty'
const SKIP_INTRO_KEY = 'pulsedrive.skipIntro'

export function loadDifficulty() {
  try {
    const saved = localStorage.getItem(DIFFICULTY_KEY)
    if (saved === 'easy' || saved === 'normal' || saved === 'hard') return saved
  } catch {
    // Fall through.
  }
  return 'normal'
}

export function saveDifficulty(name) {
  try {
    localStorage.setItem(DIFFICULTY_KEY, name)
  } catch {
    // Non-fatal.
  }
}

export function loadSkipIntro() {
  try {
    return localStorage.getItem(SKIP_INTRO_KEY) !== 'false'
  } catch {
    return true
  }
}

export function saveSkipIntro(value) {
  try {
    localStorage.setItem(SKIP_INTRO_KEY, String(value))
  } catch {
    // Non-fatal.
  }
}
