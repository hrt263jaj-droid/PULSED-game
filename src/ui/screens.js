import { TIERS } from '../fx/quality.js'
import { DIFFICULTIES } from '../game/blocks.js'

const $ = (id) => document.getElementById(id)

/**
 * All DOM handling lives here so the game loop never touches the document
 * beyond a single updateHud() call per frame.
 */
export class UI {
  constructor(handlers) {
    this.handlers = handlers
    this.current = 'title'
    this.previousScreen = 'title'

    this.screens = {
      title: $('screen-title'),
      loading: $('screen-loading'),
      pause: $('screen-pause'),
      results: $('screen-results'),
      settings: $('screen-settings'),
    }
    this.hud = $('hud')

    this._wireFileInput()
    this._wireButtons()
    this._buildTierList()
    this._buildDifficultyList()
    this._startLoadingViz()

    this.lastCombo = 1
  }

  // --- screen switching ---------------------------------------------------

  show(name) {
    for (const [key, el] of Object.entries(this.screens)) {
      el.classList.toggle('active', key === name)
    }
    this.hud.hidden = name !== 'playing'
    this.current = name
    this.loadingActive = name === 'loading'
  }

  // --- palette ------------------------------------------------------------

  setPalette(palette) {
    const root = document.documentElement.style
    root.setProperty('--accent', palette.accent)
    root.setProperty('--accent-2', palette.secondary)
    this.palette = palette
  }

  // --- file input ---------------------------------------------------------

  _wireFileInput() {
    const input = $('file-input')
    const overlay = $('drop-overlay')

    $('browse').addEventListener('click', () => input.click())
    $('dropzone').addEventListener('click', (e) => {
      if (e.target.id !== 'browse') input.click()
    })

    input.addEventListener('change', () => {
      if (input.files?.[0]) this.handlers.onFile(input.files[0])
      input.value = '' // allow re-picking the same file
    })

    // Whole window is a drop target, not just the dashed box.
    let dragDepth = 0
    window.addEventListener('dragenter', (e) => {
      e.preventDefault()
      dragDepth++
      if (this.current === 'title' || this.current === 'results') overlay.classList.add('active')
    })
    window.addEventListener('dragover', (e) => e.preventDefault())
    window.addEventListener('dragleave', (e) => {
      e.preventDefault()
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) overlay.classList.remove('active')
    })
    window.addEventListener('drop', (e) => {
      e.preventDefault()
      dragDepth = 0
      overlay.classList.remove('active')
      const file = e.dataTransfer?.files?.[0]
      if (file) this.handlers.onFile(file)
    })
  }

  _wireButtons() {
    $('try-demo').addEventListener('click', () => this.handlers.onDemo())
    $('open-settings').addEventListener('click', () => this.openSettings())
    $('pause-settings').addEventListener('click', () => this.openSettings())
    $('settings-close').addEventListener('click', () => this.closeSettings())

    $('resume').addEventListener('click', () => this.handlers.onResume())
    $('restart').addEventListener('click', () => this.handlers.onRestart())
    $('quit').addEventListener('click', () => this.handlers.onQuit())
    $('results-again').addEventListener('click', () => this.handlers.onRestart())
    $('results-new').addEventListener('click', () => this.handlers.onQuit())

    $('toggle-shake').addEventListener('change', (e) => {
      this.handlers.onShakeToggle(e.target.checked)
    })

    $('toggle-skip-intro').addEventListener('change', (e) => {
      this.handlers.onSkipIntroToggle(e.target.checked)
    })

    $('toggle-autoplay').addEventListener('change', (e) => {
      this.handlers.onAutoPlayToggle(e.target.checked)
    })

    const sens = $('mouse-sens')
    sens.addEventListener('input', (e) => {
      const raw = Number(e.target.value)
      $('mouse-sens-value').textContent = raw
      this.handlers.onSensitivityChange(raw / 1000)
    })
  }

  setSensitivity(value) {
    const raw = Math.round(value * 1000)
    $('mouse-sens').value = raw
    $('mouse-sens-value').textContent = raw
  }

  /** Show the "click to take control" prompt only when the mouse is free. */
  setPointerLocked(locked) {
    $('mouse-hint').classList.toggle('hidden', locked)
  }

  openSettings() {
    this.previousScreen = this.current
    this.show('settings')
  }

  closeSettings() {
    this.show(this.previousScreen === 'settings' ? 'title' : this.previousScreen)
  }

  _buildTierList() {
    const list = $('tier-list')
    list.innerHTML = ''
    for (const [key, tier] of Object.entries(TIERS)) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'tier'
      row.dataset.tier = key
      row.innerHTML = `<span class="tier-name">${tier.label}</span><span class="tier-note">${tier.note}</span>`
      row.addEventListener('click', () => {
        this.setSelectedTier(key)
        this.handlers.onTierChange(key)
      })
      list.appendChild(row)
    }
  }

  /**
   * Difficulty lives on the title screen rather than the pause menu: it feeds
   * lane count and block placement, both of which are baked when the track is
   * generated, so it can only take effect on the next song load.
   */
  _buildDifficultyList() {
    const list = $('difficulty-list')
    list.innerHTML = ''
    for (const [key, diff] of Object.entries(DIFFICULTIES)) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'diff-btn'
      btn.dataset.diff = key
      btn.textContent = diff.label
      btn.addEventListener('click', () => {
        this.setDifficulty(key)
        this.handlers.onDifficultyChange(key)
      })
      list.appendChild(btn)
    }
  }

  setDifficulty(key) {
    for (const el of document.querySelectorAll('.diff-btn')) {
      el.classList.toggle('selected', el.dataset.diff === key)
    }
    $('difficulty-note').textContent = DIFFICULTIES[key]?.note ?? ''
  }

  setSkipIntro(value) {
    $('toggle-skip-intro').checked = value
  }

  setAutoPlay(value) {
    $('toggle-autoplay').checked = value
  }

  setSelectedTier(key) {
    for (const el of document.querySelectorAll('.tier')) {
      el.classList.toggle('selected', el.dataset.tier === key)
    }
  }

  // --- errors -------------------------------------------------------------

  showError(message) {
    const el = $('error')
    el.textContent = message
    el.hidden = false
  }

  clearError() {
    $('error').hidden = true
  }

  // --- loading ------------------------------------------------------------

  setLoadingSong(name) {
    $('loading-song').textContent = name
  }

  setLoadingStage(stage, progress) {
    const labels = {
      reading: 'Reading file',
      decoding: 'Decoding audio',
      analyzing: 'Analyzing spectrum',
      building: 'Building track',
    }
    $('loading-stage').textContent = labels[stage] ?? stage
    $('progress-bar').style.width = `${Math.round(progress * 100)}%`

    const details = {
      reading: 'Loading from disk',
      decoding: 'Extracting waveform',
      analyzing: 'FFT · onset detection · tempo',
      building: 'Generating geometry',
    }
    $('loading-detail').textContent = details[stage] ?? ' '
  }

  /**
   * Decorative spectrum animation during the wait. Once the real analysis is
   * done, drawEnvelope() replaces it with the song's actual shape.
   */
  _startLoadingViz() {
    const canvas = $('loading-viz')
    const ctx = canvas.getContext('2d')
    this.loadingCanvas = canvas
    this.loadingCtx = ctx
    this.loadingActive = false
    this.realEnvelope = null

    const draw = () => {
      requestAnimationFrame(draw)
      if (!this.loadingActive) return

      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      const accent = this.palette?.accent ?? '#7bdcff'
      const bars = 120
      const bw = w / bars
      const t = performance.now() / 1000

      for (let i = 0; i < bars; i++) {
        const p = i / bars
        let amp
        if (this.realEnvelope) {
          amp = this.realEnvelope[Math.floor(p * this.realEnvelope.length)] ?? 0
        } else {
          // Layered sines read as "spectrum" without pretending to be data.
          amp =
            0.18 +
            Math.abs(Math.sin(p * 9 + t * 2.1)) * 0.32 +
            Math.abs(Math.sin(p * 23 - t * 3.4)) * 0.22 +
            Math.abs(Math.sin(p * 41 + t * 1.3)) * 0.14
        }
        const bh = Math.max(2, amp * h * 0.82)

        ctx.fillStyle = accent
        ctx.globalAlpha = 0.22 + amp * 0.55
        ctx.fillRect(i * bw + bw * 0.18, (h - bh) / 2, bw * 0.64, bh)
      }
      ctx.globalAlpha = 1
    }
    draw()
  }

  drawEnvelope(envelope) {
    this.realEnvelope = envelope
  }

  clearEnvelope() {
    this.realEnvelope = null
  }

  // --- HUD ----------------------------------------------------------------

  updateHud(state) {
    $('hud-score-value').textContent = Math.round(state.score).toLocaleString()
    $('hud-combo-value').textContent = `×${state.multiplier}`
    $('hud-speed-value').textContent = Math.round(state.speedKmh)
    $('song-progress-bar').style.width = `${state.progress * 100}%`
    $('overdrive-fill').style.width = `${state.overdrive * 100}%`

    const comboEl = $('hud-combo-value').parentElement
    comboEl.classList.toggle('hot', state.multiplier >= 4)
    document.querySelector('.overdrive').classList.toggle('ready', state.overdrive >= 1)

    // Flash the screen edge whenever the multiplier steps up.
    if (state.multiplier > this.lastCombo) {
      const flash = $('combo-flash')
      flash.animate(
        [{ opacity: 0.6 }, { opacity: 0 }],
        { duration: 420, easing: 'ease-out' }
      )
    }
    this.lastCombo = state.multiplier
  }

  setSongName(name) {
    $('hud-song-name').textContent = name
  }

  // --- results ------------------------------------------------------------

  showResults(data) {
    $('results-song').textContent = data.name
    $('results-score').textContent = Math.round(data.score).toLocaleString()
    $('results-combo').textContent = data.bestCombo
    $('results-collected').textContent = `${data.collected}/${data.total}`
    $('results-accuracy').textContent = `${Math.round(data.accuracy * 100)}%`

    this._drawResultsGraph(data.envelope, data.hitMap)
    this.show('results')
  }

  /** Song energy, brightened wherever the player was scoring. */
  _drawResultsGraph(envelope, hitMap) {
    const canvas = $('results-graph')
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const accent = this.palette?.accent ?? '#7bdcff'
    const dim = 'rgba(140, 160, 190, 0.25)'
    const bars = envelope.length
    const bw = w / bars

    for (let i = 0; i < bars; i++) {
      const amp = envelope[i]
      const bh = Math.max(2, amp * h * 0.9)
      const hit = hitMap[Math.floor((i / bars) * hitMap.length)] ?? 0

      ctx.fillStyle = hit > 0 ? accent : dim
      ctx.globalAlpha = hit > 0 ? 0.45 + hit * 0.55 : 1
      ctx.fillRect(i * bw, h - bh, Math.max(1, bw * 0.85), bh)
    }
    ctx.globalAlpha = 1
  }
}
