import * as THREE from 'three'
import './style.css'

import { UI } from './ui/screens.js'
import { loadSong, analyzeAudioBuffer, isAudioFile } from './audio/loader.js'
import { createDemoTrack, DEMO_NAME } from './audio/demoTrack.js'
import { Track, makeFrame } from './game/track.js'
import { createRoadMaterial } from './game/roadMaterial.js'
import {
  Blocks,
  DIFFICULTIES,
  COLLECT_RADIUS,
  OVERDRIVE_RADIUS_SCALE,
} from './game/blocks.js'
import { Vessel } from './game/vessel.js'
import { Scoring } from './game/scoring.js'
import { Environment } from './fx/environment.js'
import { Pillars } from './fx/pillars.js'
import { Tesseracts } from './fx/tesseract.js'
import { PostStack } from './fx/post.js'
import { BurstSystem, RingSystem, DustField } from './fx/particles.js'
import {
  loadTier,
  saveTier,
  getSettings,
  loadSensitivity,
  saveSensitivity,
  loadDifficulty,
  saveDifficulty,
  loadSkipIntro,
  saveSkipIntro,
  loadAutoPlay,
  saveAutoPlay,
} from './fx/quality.js'

const CAMERA_LAG = 0.30 // seconds of track behind the vessel
const CAMERA_LOOKAHEAD = 0.6
const CAMERA_HEIGHT = 8.2
const BASE_FOV = 68 // see the note where targetFov is computed
const HIT_BUCKETS = 200
const KEY_SPEED = 29 // units/sec when steering by keyboard under pointer lock
// Largest movementX honoured from a single mousemove, in pixels. High enough
// that no real flick is capped (fast flicks arrive as many events, not one big
// one), low enough to reject pointer-lock's occasional garbage spike.
const MAX_MOUSE_STEP = 260

/**
 * Yield long enough for the loading UI to paint before we block on geometry.
 *
 * Races requestAnimationFrame against a timer: rAF is suspended entirely in a
 * background tab, so awaiting it alone stalls the whole load pipeline if the
 * player switches away mid-load.
 */
function nextPaint(timeout = 250) {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    requestAnimationFrame(finish)
    setTimeout(finish, timeout)
  })
}

class Game {
  constructor() {
    this.canvas = document.getElementById('scene')
    this.tierName = loadTier()
    this.settings = getSettings(this.tierName)
    this.shakeEnabled = true
    this.difficultyName = loadDifficulty()
    this.skipIntro = loadSkipIntro()
    this.autoPlay = loadAutoPlay()
    this.run = null
    this.frame = makeFrame()
    this.camFrame = makeFrame()
    this.aheadFrame = makeFrame()
    this.lastFrameTime = performance.now()

    this.keys = new Set()
    // Mouse movement is accumulated between frames: mousemove fires at its own
    // rate, which is often higher than the frame rate.
    this.mouseDX = 0
    this.pointerLocked = false
    this.skipNextMouse = false
    this.sensitivity = loadSensitivity()
    this.beatPulse = 0
    this.lastOnsetIndex = 0
    this.camPos = new THREE.Vector3()
    this.camLook = new THREE.Vector3()
    this.lookScratch = new THREE.Vector3()
    // Smoothed separately from the road frame so the horizon doesn't swing in
    // lockstep with every bass bump.
    this.camUp = new THREE.Vector3(0, 1, 0)
    this.cameraReady = false
    this.tmp = new THREE.Vector3()
    this.drift = new THREE.Vector3()
    this.tmpColor = new THREE.Color()

    // Auto-play mode - enabled by default for spectator mode
    this.autoPlay = true
    // Look-ahead time for auto-play to react to upcoming blocks (in seconds)
    this.autoPlayLookAhead = 0.35
    // Smoothing factor for auto-play steering
    this.autoPlaySmooth = 0.15
    // Target offset calculated by auto-play
    this.autoPlayTargetOffset = 0

    this._initRenderer()
    this._initScene()
    this._initUI()
    this._initInput()

    window.addEventListener('resize', () => this._resize())
    this._resize()
    this._loop()
  }

  // --- setup --------------------------------------------------------------

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.settings.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.maxPixelRatio))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setClearColor(0x03040a, 1)
  }

  _initScene() {
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, 3000)
    this.camera.position.set(0, 8, -20)

    // The vessel is the only lit object in the scene; everything else is
    // emissive or shader-driven.
    this.scene.add(new THREE.AmbientLight(0x8899cc, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(0.4, 1, 0.35)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x6688ff, 1.4)
    rim.position.set(-0.6, 0.2, -1)
    this.scene.add(rim)
  }

  _initUI() {
    this.ui = new UI({
      onFile: (file) => this._handleFile(file),
      onDemo: () => this._handleDemo(),
      onTierChange: (name) => this._setTier(name),
      onResume: () => this._resume(),
      onRestart: () => this._restart(),
      onQuit: () => this._quit(),
      onShakeToggle: (v) => {
        this.shakeEnabled = v
      },
      onSensitivityChange: (v) => {
        this.sensitivity = v
        saveSensitivity(v)
      },
      onDifficultyChange: (name) => {
        this.difficultyName = name
        saveDifficulty(name)
      },
      onSkipIntroToggle: (v) => {
        this.skipIntro = v
        saveSkipIntro(v)
      },
      onAutoPlayToggle: (v) => {
        this.autoPlay = v
        saveAutoPlay(v)
      },
    })
    this.ui.setSelectedTier(this.tierName)
    this.ui.setSensitivity(this.sensitivity)
    this.ui.setDifficulty(this.difficultyName)
    this.ui.setSkipIntro(this.skipIntro)
    this.ui.setAutoPlay(this.autoPlay)
  }

  _initInput() {
    window.addEventListener('keydown', (e) => {
      // Don't swallow browser shortcuts.
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const code = e.code
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space'].includes(code)) e.preventDefault()
      this.keys.add(code)

      if (code === 'Escape') this._togglePause()
      if (code === 'KeyR' && (this.state === 'playing' || this.state === 'paused')) this._restart()
      if (code === 'Space' && this.state === 'playing') this._tryOverdrive()
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => {
      this.keys.clear()
      if (this.state === 'playing') this._pause()
    })

    // --- pointer lock -----------------------------------------------------
    // A lock can only be granted from a user gesture, and the run begins after
    // an await chain (decode, analysis, geometry) by which point the original
    // click's activation has expired -- so we prompt for a fresh click instead
    // of requesting it automatically.
    // mousedown rather than click: a game action should fire on press, not on
    // release. The lock-acquiring press is consumed by the request and can't
    // also spend overdrive, because pointerLocked is still false at that point.
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return
      if (!this.pointerLocked) {
        this._requestPointerLock()
        return
      }
      if (e.button === 0) this._tryOverdrive()
    })

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas
      this.ui.setPointerLocked(this.pointerLocked)
      this.mouseDX = 0
      // The very first move after a lock engages is measured from wherever the
      // OS cursor happened to be, so it can be enormous. Drop it outright.
      this.skipNextMouse = this.pointerLocked
      // Escape releases the lock at the browser level before our keydown
      // handler sees it, so treat a lost lock during play as a pause. Without
      // this the game would keep running with no way to steer.
      if (!this.pointerLocked && this.state === 'playing') this._pause()
    })

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return
      if (this.skipNextMouse) {
        this.skipNextMouse = false
        return
      }
      // Clamp each event rather than the per-frame total: a genuine fast flick
      // arrives as many events and must stay uncapped in aggregate, but no
      // single legitimate movement is this large. Without this, one spurious
      // spike reads as being teleported across the road.
      this.mouseDX += THREE.MathUtils.clamp(e.movementX, -MAX_MOUSE_STEP, MAX_MOUSE_STEP)
    })
  }

  _requestPointerLock() {
    if (this.pointerLocked) return
    const result = this.canvas.requestPointerLock?.()
    // Newer Chrome returns a promise that rejects if the gesture has expired.
    // The on-screen prompt stays up, so there's nothing to handle.
    if (result?.catch) result.catch(() => {})
  }

  _resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.run?.post?.setSize(w, h)
  }

  // --- audio context ------------------------------------------------------

  _ensureAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (this.audioContext.state === 'suspended') this.audioContext.resume()
    return this.audioContext
  }

  // --- loading ------------------------------------------------------------

  _handleFile(file) {
    if (!isAudioFile(file)) {
      this.ui.showError(`"${file.name}" doesn't look like an audio file.`)
      return
    }
    const ctx = this._ensureAudioContext()
    return this._load(file.name.replace(/\.[^.]+$/, ''), (onProgress) =>
      loadSong(file, ctx, onProgress)
    )
  }

  _handleDemo() {
    const ctx = this._ensureAudioContext()
    return this._load(DEMO_NAME, async (onProgress) => {
      onProgress('decoding', 0)
      // Yield so the loading screen paints before we block synthesizing.
      await nextPaint()
      const buffer = createDemoTrack(ctx)
      return analyzeAudioBuffer(buffer, DEMO_NAME, onProgress)
    })
  }

  /**
   * Shared load pipeline: show the loading screen, run `produce` to get a
   * decoded buffer + SongMap, build the world, then start.
   */
  async _load(displayName, produce) {
    if (this.state === 'loading') return

    this._stopPlayback()
    this.ui.clearError()
    this.ui.clearEnvelope()
    this.ui.setLoadingSong(displayName)
    this.ui.setLoadingStage('reading', 0)
    this.ui.show('loading')
    this.state = 'loading'

    try {
      const loaded = await produce((stage, progress) => {
        this.ui.setLoadingStage(stage, stage === 'analyzing' ? progress * 0.9 : 0.05)
      })

      this.ui.setLoadingStage('building', 0.94)
      await nextPaint()

      this._buildRun(loaded)

      this.ui.setLoadingStage('building', 1)
      this.ui.drawEnvelope(loaded.songMap.envelope)
      await new Promise((r) => setTimeout(r, 850)) // let the envelope land

      this._startRun()
    } catch (err) {
      console.error(err)
      this.ui.showError(
        err?.message?.includes('decode') || err?.name === 'EncodingError'
          ? "Couldn't decode that file — the browser may not support this codec."
          : `Failed to load: ${err?.message ?? err}`
      )
      this.state = 'title'
      this.ui.show('title')
    }
  }

  _buildRun(loaded) {
    this._disposeRun()

    const { songMap, audioBuffer, name } = loaded
    const palette = songMap.palette
    const difficulty = DIFFICULTIES[this.difficultyName] ?? DIFFICULTIES.normal

    this.ui.setPalette(palette)
    this.renderer.setClearColor(new THREE.Color(palette.fog), 1)

    const track = new Track(songMap, difficulty.lanes)

    const roadMaterial = createRoadMaterial(palette)
    roadMaterial.uniforms.uLaneCount.value = difficulty.lanes
    roadMaterial.uniforms.uFogFar.value = this.settings.environmentDistance * 0.8
    roadMaterial.uniforms.uFogNear.value = this.settings.environmentDistance * 0.25
    const road = new THREE.Mesh(track.geometry, roadMaterial)
    road.frustumCulled = false
    // Explicit ordering: road, then blocks, then particles. Left to three's
    // distance sort these would swap around as the track winds.
    road.renderOrder = 1
    this.scene.add(road)

    const environment = new Environment(this.scene, palette, this.settings)
    const pillars = new Pillars(this.scene, track, songMap, palette, this.settings)
    const tesseracts = new Tesseracts(this.scene, palette, this.settings)
    const blocks = new Blocks(this.scene, track, songMap, palette, difficulty)
    const vessel = new Vessel(this.scene, palette)
    const bursts = new BurstSystem(this.scene, this.settings)
    const rings = new RingSystem(this.scene, this.settings)
    const dust = new DustField(this.scene, palette, this.settings)
    const post = new PostStack(this.renderer, this.scene, this.camera, this.settings, palette)
    post.setSize(window.innerWidth, window.innerHeight)

    this.run = {
      songMap,
      audioBuffer,
      name,
      palette,
      difficulty,
      track,
      road,
      roadMaterial,
      environment,
      pillars,
      tesseracts,
      blocks,
      vessel,
      bursts,
      rings,
      dust,
      post,
      scoring: new Scoring(),
      hitMap: new Float32Array(HIT_BUCKETS),
      source: null,
      startAt: 0,
    }

    this.ui.setSongName(name)
    this.lastOnsetIndex = 0
    this.beatPulse = 0
  }

  _startRun() {
    const run = this.run
    if (!run) return

    const ctx = this._ensureAudioContext()
    run.scoring.reset()
    run.blocks.reset()
    run.bursts.reset()
    run.rings.reset()
    run.vessel.reset()
    run.hitMap.fill(0)
    this.lastOnsetIndex = 0

    // Seek past a long ambient lead-in, which otherwise means crawling uphill
    // through an empty track before anything happens.
    const introEnd = run.songMap.introEnd ?? 0
    const offset = this.skipIntro && introEnd > 4 ? introEnd : 0
    if (offset > 0) {
      // Retire the skipped blocks without scoring them, or they all resolve as
      // misses the moment play begins.
      run.blocks.skipTo(offset)
    }

    const source = ctx.createBufferSource()
    source.buffer = run.audioBuffer
    source.connect(ctx.destination)
    const beginAt = ctx.currentTime + 1.2 // lead-in so the first blocks are visible
    // songTime is derived as (currentTime - startAt), so shifting startAt back
    // by the offset makes it read `offset` at the instant audio begins.
    run.startAt = beginAt - offset
    source.start(beginAt, offset)
    run.source = source

    this.state = 'playing'
    this.ui.show('playing')
    this.mouseDX = 0
    this.cameraReady = false // snap the rig into place on the first frame
    this.ui.setPointerLocked(this.pointerLocked)
    // Succeeds when this came from a button click, silently declines when it
    // came from the load pipeline. Either way the prompt covers it.
    this._requestPointerLock()
  }

  _stopPlayback() {
    if (this.run?.source) {
      try {
        this.run.source.stop()
      } catch {
        // Already stopped; nothing to do.
      }
      this.run.source.disconnect()
      this.run.source = null
    }
  }

  // --- state transitions --------------------------------------------------

  _togglePause() {
    if (this.state === 'playing') this._pause()
    else if (this.state === 'paused') this._resume()
    else if (this.state === 'settings') this.ui.closeSettings()
  }

  _pause() {
    if (this.state !== 'playing') return
    this.state = 'paused'
    // Suspending freezes ctx.currentTime, so song time stops with it and no
    // separate pause bookkeeping is needed.
    this.audioContext?.suspend()
    this.ui.show('pause')
    // Anything accumulated across the pause would otherwise be applied as a
    // single lurch on resume.
    this.mouseDX = 0
  }

  _resume() {
    if (this.state !== 'paused' && this.state !== 'settings') return
    this.state = 'playing'
    this.audioContext?.resume()
    this.ui.show('playing')
    this.mouseDX = 0
    // The Resume click is a fresh user gesture, so the lock can be reclaimed
    // here without making the player click the canvas again.
    this._requestPointerLock()
  }

  _restart() {
    if (!this.run) return
    this._stopPlayback()
    this.audioContext?.resume()
    this._startRun()
  }

  _quit() {
    this._stopPlayback()
    if (document.pointerLockElement) document.exitPointerLock()
    this.audioContext?.resume()
    this.state = 'title'
    this.ui.clearEnvelope()
    this.ui.show('title')
  }

  _finish() {
    const run = this.run
    this._stopPlayback()
    // Give the cursor back so the results buttons are clickable.
    if (document.pointerLockElement) document.exitPointerLock()
    this.state = 'results'

    // Normalize the hit map for the results graph.
    let peak = 0
    for (const v of run.hitMap) peak = Math.max(peak, v)
    if (peak > 0) for (let i = 0; i < run.hitMap.length; i++) run.hitMap[i] /= peak

    this.ui.showResults({
      name: run.name,
      score: run.scoring.score,
      bestCombo: run.scoring.bestCombo,
      collected: run.scoring.collected,
      // Skipped intro blocks don't count against you -- you were never given
      // the chance to reach them.
      total: run.blocks.scoreableTotal,
      // Against the full reachable count, not just the ones that were resolved
      // -- otherwise a run that ends early reports a flattering 100%.
      accuracy:
        run.blocks.scoreableTotal > 0
          ? run.scoring.collected / run.blocks.scoreableTotal
          : 0,
      envelope: run.songMap.envelope,
      hitMap: run.hitMap,
    })
  }

  _tryOverdrive() {
    const run = this.run
    if (!run) return
    const songTime = this._songTime()
    if (run.scoring.tryStartOverdrive(songTime)) {
      run.vessel.velocity *= 0.6
      this.beatPulse = 1
    }
  }

  _setTier(name) {
    this.tierName = name
    this.settings = getSettings(name)
    saveTier(name)

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.maxPixelRatio))

    // Antialias is fixed at context creation, so it takes effect on reload.
    // Everything else can be rebuilt live.
    if (this.run) {
      this.run.post.dispose()
      this.run.post = new PostStack(
        this.renderer,
        this.scene,
        this.camera,
        this.settings,
        this.run.palette
      )
      this.run.post.setSize(window.innerWidth, window.innerHeight)

      this.run.environment.dispose()
      this.run.environment = new Environment(this.scene, this.run.palette, this.settings)

      this.run.pillars.dispose()
      this.run.pillars = new Pillars(
        this.scene,
        this.run.track,
        this.run.songMap,
        this.run.palette,
        this.settings
      )

      this.run.tesseracts.dispose()
      this.run.tesseracts = new Tesseracts(this.scene, this.run.palette, this.settings)

      this.run.dust.dispose()
      this.run.dust = new DustField(this.scene, this.run.palette, this.settings)

      // Particle budgets are baked at construction, so these have to be rebuilt
      // too or a tier change silently leaves them at the old capacity.
      this.run.bursts.dispose()
      this.run.bursts = new BurstSystem(this.scene, this.settings)
      this.run.rings.dispose()
      this.run.rings = new RingSystem(this.scene, this.settings)

      this.run.roadMaterial.uniforms.uFogFar.value = this.settings.environmentDistance
      this.run.roadMaterial.uniforms.uFogNear.value = this.settings.environmentDistance * 0.25
    }
  }

  _disposeRun() {
    if (!this.run) return
    this._stopPlayback()
    this.run.blocks.dispose()
    this.run.vessel.dispose()
    this.run.bursts.dispose()
    this.run.rings.dispose()
    this.run.dust.dispose()
    this.run.environment.dispose()
    this.run.pillars.dispose()
    this.run.tesseracts.dispose()
    this.run.post.dispose()
    this.scene.remove(this.run.road)
    this.run.roadMaterial.dispose()
    this.run.track.dispose()
    this.run = null
  }

  // --- per-frame ----------------------------------------------------------

  _songTime() {
    if (!this.run || !this.audioContext) return 0
    return this.audioContext.currentTime - this.run.startAt
  }

  /** Sample the pre-computed spectrum at the current playhead. */
  _bandsAt(songTime) {
    const map = this.run.songMap
    const i = THREE.MathUtils.clamp(
      Math.round(songTime * map.framesPerSec),
      0,
      map.frameCount - 1
    )
    return {
      bass: map.bands.bass[i] ?? 0,
      lowMid: map.bands.lowMid[i] ?? 0,
      mid: map.bands.mid[i] ?? 0,
      treble: map.bands.treble[i] ?? 0,
      rms: map.rms[i] ?? 0,
    }
  }

  _update(dt) {
    const run = this.run
    const songTime = this._songTime()

    if (songTime >= run.track.songMap.duration) {
      this._finish()
      return
    }

    const playT = Math.max(0, songTime)
    const bands = this._bandsAt(playT)
    run.scoring.update(dt, playT)

    // --- beat pulse -------------------------------------------------------
    const onsets = run.songMap.onsets
    while (this.lastOnsetIndex < onsets.length && onsets[this.lastOnsetIndex].t <= playT) {
      this.beatPulse = Math.max(this.beatPulse, onsets[this.lastOnsetIndex].strength)
      this.lastOnsetIndex++
    }
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.2)

    // --- track frame ------------------------------------------------------
    run.track.sample(playT, this.frame)
    const speed01 = THREE.MathUtils.clamp(
      (this.frame.speed - 34) / (run.track.maxSpeed - 34),
      0,
      1
    )

    // --- steering ---------------------------------------------------------
    let steer = 0
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) steer -= 1
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) steer += 1
    const limit = run.track.halfWidth - 0.9

    if (this.pointerLocked) {
      // Mouse is authoritative. Keys fold into the same positional model rather
      // than running two steering systems against one offset.
      run.vessel.moveBy(this.mouseDX * this.sensitivity + steer * KEY_SPEED * dt, dt, limit)
      this.mouseDX = 0
    } else {
      run.vessel.steer(dt, steer, limit, speed01)
    }

    // --- Auto-play steering ------------------------------------------------
    // When auto-play is enabled and no human input is active, automatically
    // steer to collect notes and avoid hazards by looking ahead at upcoming blocks.
    if (this.autoPlay && !this.pointerLocked && this.keys.size === 0) {
      this._updateAutoPlaySteering(run, playT, limit, speed01, dt)
    }

    // --- blocks -----------------------------------------------------------
    // Overdrive widens the collection window in both directions -- it sweeps up
    // notes you couldn't otherwise reach, and it catches hazards you'd
    // otherwise have missed. Speed itself is locked to the audio and can't be
    // boosted without desync, so reach is the mechanic.
    const radiusScale = run.scoring.overdriveActive ? OVERDRIVE_RADIUS_SCALE : 1
    const events = run.blocks.update(playT, run.vessel.offset, radiusScale)

    // Debris inherits most of the craft's motion, otherwise the vessel outruns
    // its own explosion within two frames and you never see it.
    this.drift.copy(this.frame.forward).multiplyScalar(this.frame.speed * 0.82)

    for (const item of events.collected) {
      run.scoring.collect(item.strength, playT)
      const bucket = Math.min(
        HIT_BUCKETS - 1,
        Math.floor((item.t / run.songMap.duration) * HIT_BUCKETS)
      )
      run.hitMap[bucket] += 1
      run.blocks.positionOf(item, this.tmp)
      this.tmpColor.set(item.band === 0 ? run.palette.primary : run.palette.accent)
      const power = 0.5 + item.strength * 0.5
      run.bursts.emit(this.tmp, this.tmpColor, playT, power, this.drift)
      run.rings.emit(this.tmp, this.tmpColor, playT, 0.75 + power * 0.5, this.drift)
    }
    for (const item of events.hazards) {
      run.scoring.hitHazard(playT)
      run.blocks.positionOf(item, this.tmp)
      // Cold white rather than the palette's hazard hue: colour belongs to
      // things worth collecting. The full-screen red flash carries the "bad".
      this.tmpColor.set('#cfdcf0')
      run.bursts.emit(this.tmp, this.tmpColor, playT, 1, this.drift)
      // Bigger, angrier ring so a hazard reads differently from a pickup.
      run.rings.emit(this.tmp, this.tmpColor, playT, 2.1, this.drift)
    }
    if (events.missed) run.scoring.miss()

    // --- vessel -----------------------------------------------------------
    run.vessel.place(this.frame, dt, playT, bands.bass, speed01)
    // Beam width is the true collection radius, so what you see is exactly
    // what you sweep -- including the hazards.
    run.vessel.updateBeam(
      run.scoring.overdriveActive,
      COLLECT_RADIUS * OVERDRIVE_RADIUS_SCALE,
      dt,
      playT
    )

    // --- camera -----------------------------------------------------------
    this._updateCamera(playT, dt, speed01, run)

    // --- uniforms ---------------------------------------------------------
    const intensity = run.scoring.intensity
    const u = run.roadMaterial.uniforms
    u.uTime.value = playT
    u.uCombo.value = intensity
    u.uBeat.value = this.beatPulse

    run.environment.update(playT, this.camera, bands, this.renderer.getPixelRatio())
    run.pillars.update(playT, this.beatPulse, bands.bass)
    run.tesseracts.update(run.track, playT, playT, dt, bands.bass)
    run.bursts.update(playT, this.renderer.getPixelRatio())
    run.rings.update(playT, this.renderer.getPixelRatio())
    run.dust.update(this.camera, speed01, this.renderer.getPixelRatio())
    run.post.update({
      time: playT,
      speed01,
      combo01: intensity,
      hit01: run.scoring.hitFlash,
    })

    // --- HUD --------------------------------------------------------------
    this.ui.updateHud({
      score: run.scoring.score,
      multiplier: run.scoring.multiplier,
      speedKmh: this.frame.speed * 3.6 * 1.9, // scaled for readability, not realism
      progress: THREE.MathUtils.clamp(playT / run.songMap.duration, 0, 1),
      overdrive: run.scoring.overdrive,
    })
  }

  _updateCamera(songTime, dt, speed01, run) {
    // Camera anchors are sampled in *time*, so at speed the camera naturally
    // pulls further back -- the track points are simply spaced wider there.
    run.track.sample(Math.max(0, songTime - CAMERA_LAG), this.camFrame)
    run.track.sample(songTime + CAMERA_LOOKAHEAD, this.aheadFrame)

    const target = this.tmp
      .copy(this.camFrame.position)
      .addScaledVector(this.camFrame.up, CAMERA_HEIGHT)
      .addScaledVector(this.camFrame.right, run.vessel.offset * 0.55)

    const desiredLook = this.lookScratch
      .copy(this.aheadFrame.position)
      .addScaledVector(this.aheadFrame.up, 2.4)
      .addScaledVector(this.aheadFrame.right, run.vessel.offset * 0.32)

    if (!this.cameraReady) {
      // Snap on the first frame, otherwise the rig visibly swings in from
      // wherever the previous run left it.
      this.camPos.copy(target)
      this.camLook.copy(desiredLook)
      this.camUp.copy(this.camFrame.up)
      this.cameraReady = true
    } else {
      // Damped follow, frame-rate independent. The aim point and the up vector
      // are damped more softly than the position: tracking the road's pitch
      // exactly makes the horizon lurch on every bump, which reads as far
      // bigger hills than the geometry actually has.
      this.camPos.lerp(target, 1 - Math.exp(-dt * 9))
      this.camLook.lerp(desiredLook, 1 - Math.exp(-dt * 5.5))
      this.camUp.lerp(this.camFrame.up, 1 - Math.exp(-dt * 4.5)).normalize()
    }

    const look = this.camLook
    this.camera.position.copy(this.camPos)

    // Shake on damage and on heavy beats.
    if (this.shakeEnabled) {
      const shake = run.scoring.hitFlash * 1.4 + this.beatPulse * 0.12 * speed01
      if (shake > 0.001) {
        this.camera.position.x += (Math.random() - 0.5) * shake
        this.camera.position.y += (Math.random() - 0.5) * shake
      }
    }

    this.camera.up.copy(this.camUp)
    this.camera.lookAt(look)

    // FOV widens with speed and overdrive -- the cheapest speed cue there is.
    // A wide base also flattens the apparent size of hills: the same crest
    // fills much less of the frame at 74 degrees than at 60.
    const targetFov = BASE_FOV + speed01 * 12 + (run.scoring.overdriveActive ? 6 : 0)
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4)
      this.camera.updateProjectionMatrix()
    }
  }

  /**
   * Auto-play steering logic: look ahead at upcoming blocks and steer to collect
   * notes while avoiding hazards. Called when autoPlay is enabled and no human
   * input is active.
   */
  _updateAutoPlaySteering(run, songTime, limit, speed01, dt) {
    // Look ahead at upcoming blocks within the look-ahead window
    const lookAheadTime = songTime + this.autoPlayLookAhead
    const items = run.blocks.items

    // Find the next few unresolved blocks
    let bestTarget = 0
    let bestScore = -Infinity
    let foundTarget = false

    // Track multiple upcoming items for path planning
    const upcomingTargets = []
    for (let i = run.blocks.cursor; i < items.length && i < run.blocks.cursor + 20; i++) {
      const item = items[i]
      if (item.resolved) continue
      if (item.t > lookAheadTime) break

      const timeUntil = item.t - songTime
      const distance = Math.abs(run.vessel.offset - item.offset)
      const urgency = 1 / Math.max(0.05, timeUntil)

      let score = 0
      if (item.hazard) {
        // Avoid hazards - negative score based on how close we are to hitting them
        // Higher penalty if we're close to the hazard's lane
        score = -urgency * 15 * (1 - distance / (limit * 1.5))
      } else {
        // Collect collectibles - positive score based on strength and urgency
        // Prioritize stronger notes and closer items
        score = item.strength * urgency * 2 * (1 + (1 - distance / limit))
      }

      upcomingTargets.push({ item, score, timeUntil, distance, offset: item.offset })

      if (score > bestScore) {
        bestScore = score
        bestTarget = item.offset
        foundTarget = true
      }
    }

    // If no immediate targets, look further ahead for upcoming collectibles
    if (!foundTarget) {
      for (let i = run.blocks.cursor; i < items.length && i < run.blocks.cursor + 40; i++) {
        const item = items[i]
        if (item.resolved || item.hazard) continue
        if (item.t > songTime + this.autoPlayLookAhead * 4) break

        const timeUntil = item.t - songTime
        const distance = Math.abs(run.vessel.offset - item.offset)
        const score = item.strength / Math.max(0.05, timeUntil) * (1 - distance / limit * 0.3)

        if (score > bestScore) {
          bestScore = score
          bestTarget = item.offset
          foundTarget = true
        }
      }
    }

    // If still no target found, gently return to center
    if (!foundTarget) {
      bestTarget = 0
    }

    // Predictive steering: anticipate where we need to be for the NEXT note
    // by looking at the sequence of upcoming items
    if (upcomingTargets.length >= 2) {
      // Sort by time
      upcomingTargets.sort((a, b) => a.timeUntil - b.timeUntil)

      // Check if we need to start moving early for a note that comes after the current target
      for (let i = 0; i < Math.min(3, upcomingTargets.length - 1); i++) {
        const current = upcomingTargets[i]
        const next = upcomingTargets[i + 1]
        if (current.item.hazard || next.item.hazard) continue

        // If we're currently moving toward current, but next is in opposite direction,
        // start moving toward next early
        const currentDir = Math.sign(current.offset - run.vessel.offset)
        const nextDir = Math.sign(next.offset - run.vessel.offset)

        if (currentDir !== 0 && nextDir !== 0 && currentDir !== nextDir) {
          // Need to change direction - bias toward the next target earlier
          const transitionUrgency = 1 / Math.max(0.1, next.timeUntil)
          bestTarget = THREE.MathUtils.lerp(current.offset, next.offset, 0.3 * transitionUrgency)
          break
        }
      }
    }

    // Smoothly interpolate towards target with adaptive smoothing
    // Faster response for urgent notes, smoother for distant ones
    const adaptiveSmooth = foundTarget ? this.autoPlaySmooth : this.autoPlaySmooth * 0.5
    const targetDiff = bestTarget - run.vessel.offset
    this.autoPlayTargetOffset += (targetDiff - this.autoPlayTargetOffset) * adaptiveSmooth

    // Apply steering using moveBy (direct position control like mouse)
    const maxStep = limit * 3 * dt // max units per frame
    const clampedStep = THREE.MathUtils.clamp(this.autoPlayTargetOffset, -maxStep, maxStep)

    if (Math.abs(clampedStep) > 0.005) {
      run.vessel.moveBy(clampedStep, dt, limit)
    }

    // Auto-trigger overdrive when it's ready and we have a good opportunity
    if (run.scoring.overdrive >= 1 && !run.scoring.overdriveActive) {
      // Check if there are many collectibles coming up soon
      let upcomingCollectibles = 0
      for (let i = run.blocks.cursor; i < items.length && i < run.blocks.cursor + 10; i++) {
        const item = items[i]
        if (item.resolved || item.hazard) continue
        if (item.t - songTime < 3.0) upcomingCollectibles++
      }
      // Trigger overdrive if we have a cluster of notes coming
      if (upcomingCollectibles >= 3) {
        this._tryOverdrive()
      }
    }
  }

  _loop() {
    requestAnimationFrame(() => this._loop())
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000)
    this.lastFrameTime = now

    if (this.state === 'playing') this._update(dt)

    if (this.run) {
      this.run.post.render(this.scene, this.camera, dt)
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }
}

const game = new Game()

// Handy from the devtools console while tuning.
if (import.meta.env.DEV) window.__game = game
