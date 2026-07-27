const BASE_POINTS = 60
const COMBO_STEP = 8 // collections per multiplier step
const MAX_MULTIPLIER = 8
const OVERDRIVE_PER_COLLECT = 0.022
const OVERDRIVE_DURATION = 4.5

export class Scoring {
  constructor() {
    this.reset()
  }

  reset() {
    this.score = 0
    this.combo = 0
    this.bestCombo = 0
    this.collected = 0
    this.missed = 0
    this.hazardsHit = 0
    this.overdrive = 0
    this.overdriveActive = false
    this.overdriveEnds = 0
    this.hitFlash = 0
  }

  get multiplier() {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.combo / COMBO_STEP))
  }

  /** 0..1 -- drives bloom, road heat and the color grade. */
  get intensity() {
    const fromCombo = (this.multiplier - 1) / (MAX_MULTIPLIER - 1)
    return Math.min(1, fromCombo + (this.overdriveActive ? 0.35 : 0))
  }

  collect(strength, songTime) {
    this.combo++
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.collected++
    this.score += BASE_POINTS * (0.6 + strength * 0.8) * this.multiplier * (this.overdriveActive ? 2 : 1)
    if (!this.overdriveActive) {
      this.overdrive = Math.min(1, this.overdrive + OVERDRIVE_PER_COLLECT)
    }
  }

  miss() {
    // A miss softens the combo rather than wiping it -- hazards are the real
    // punishment, and losing everything to one unreachable block feels unfair.
    this.combo = Math.max(0, this.combo - 2)
  }

  hitHazard(songTime) {
    this.hazardsHit++
    this.combo = 0
    this.score = Math.max(0, this.score - 250)
    this.overdrive = Math.max(0, this.overdrive - 0.3)
    this.hitFlash = 1
  }

  tryStartOverdrive(songTime) {
    if (this.overdrive < 1 || this.overdriveActive) return false
    this.overdriveActive = true
    this.overdriveEnds = songTime + OVERDRIVE_DURATION
    return true
  }

  update(dt, songTime) {
    if (this.overdriveActive) {
      const remaining = Math.max(0, this.overdriveEnds - songTime)
      this.overdrive = remaining / OVERDRIVE_DURATION
      if (remaining <= 0) {
        this.overdriveActive = false
        this.overdrive = 0
      }
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.2)
  }

  get accuracy() {
    const attempts = this.collected + this.missed
    return attempts > 0 ? this.collected / attempts : 0
  }
}
