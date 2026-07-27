# PULSEDRIVE — design doc

*(working title)*

A browser-based Audiosurf-style rhythm racer. Player drops in their own audio file,
the game analyzes it, and builds a track whose hills, turns, colors, and obstacles
are all derived from that specific song. Built with three.js + Vite, vanilla JS.

---

## Part 1 — The prompt, as if I'd written it myself

> Build a web-based music-driven racing game in the spirit of Audiosurf. The player
> loads their own audio file from their machine. Before play starts, decode and
> analyze the entire track offline — not with a live analyser node — so the game
> knows the whole song's shape in advance and can build a road the player can *see
> coming*. That foresight is the entire feel of the genre; a game that only knows
> the current moment cannot produce it.
>
> From that analysis, generate a single continuous ribbon of highway threading
> through empty space. Overall energy drives elevation: loud passages are peaks,
> quiet passages are valleys, and the vessel accelerates downhill and labors uphill,
> so the player physically feels the song's dynamics through the speedometer. Detected
> onsets become collectible blocks placed in lanes, with the frequency band that
> triggered each onset deciding its lane and color — bass in the center, treble at
> the edges. The result should be that a listener who knows the song recognizes it
> in the geometry before the audio confirms it.
>
> Make it look expensive. Bloom is mandatory. Engine thrust that flares on bass hits,
> speed streaks that stretch with velocity, particle bursts on collection, and
> beat-synced light architecture flanking the road. Derive the entire color palette
> from the song's spectral character, so a doom metal track and a synthpop track
> produce visibly different worlds from the same code.
>
> It must hold 60fps on an integrated-graphics laptop at 1366×768 and resize
> correctly at any aspect ratio. Detect weak hardware and scale down gracefully
> rather than stuttering. Prioritize fun over realism everywhere the two conflict —
> if a physically correct behavior feels worse, discard it.

---

## Part 1.5 — Locked decisions

- **Mechanic:** collect + dodge. Colored blocks score and build combo; grey/red hazards
  break it. No puzzle grid.
- **Vessel:** hovering craft / rocket. No wheel contact, so terrain is free.
- **Art:** abstract cosmic — nebulae, particle fields, translucent ribbons, aurora.
- **Audio:** user-loaded local files only.

### Readability plan for abstract cosmic

Cosmic is the least readable of the three styles at speed, so contrast is managed
deliberately rather than left to chance:

- **Background carries no high-frequency detail.** Nebulae are large, soft, low-contrast,
  and far away. They never compete with gameplay elements.
- **The road is the brightest coherent structure on screen.** Translucent ribbon with hard
  emissive edge lines — the one piece of clean geometry in a soft world, so it reads
  instantly.
- **Collectibles are self-luminous** and sit above the road surface with a subtle ground
  glow beneath, so they never get lost against a bright nebula.
- **Hazards differ by silhouette, not just color** — jagged dark shards with a hot rim vs.
  smooth glowing collectibles. Readable at speed, and colorblind-safe.
- Fog color pulled from the palette pushes the background back and isolates the play space.

---

## Part 2 — Architecture

### The critical decision: offline analysis, not live

`AnalyserNode` only knows the present instant. Audiosurf's feel depends on seeing the
road ahead. So:

1. User provides file → `arrayBuffer` → `AudioContext.decodeAudioData()`
2. Get raw PCM as `Float32Array`
3. Run a windowed FFT over the whole buffer (2048 window, 512 hop ≈ 86 frames/sec)
4. Per frame, extract: bass (20–250Hz), low-mid (250–800), mid (800–2500),
   treble (2500–10k), overall RMS
5. Onset detection via spectral flux with an adaptive median threshold
6. Estimate global BPM from onset autocorrelation (used for environment pulsing)
7. Emit a `SongMap` — the complete gameplay timeline
8. Generate all track geometry from the `SongMap` in one pass, before play begins

Cost: roughly 2–5s for a 4-minute song. This becomes a **feature** — the loading
screen renders the waveform assembling itself and the track unfurling into the
distance. First impression of the game is the analysis, so it should look great.

Runs in a Web Worker so the loading animation never stutters.

### SongMap shape

```js
{
  duration, bpm, sampleRate,
  frames: [{ t, bass, lowMid, mid, treble, rms, flux }],
  onsets: [{ t, band, strength }],
  sections: [{ t, intensity }],   // coarse structure: verse/chorus energy tiers
  palette: { primary, secondary, accent, fog }  // derived from spectral centroid
}
```

### Track generation

- **Elevation** — smoothed RMS, mapped to a spline. Chorus = summit, breakdown = valley.
- **Curvature** — driven by a low-frequency noise field seeded by a hash of the song,
  amplitude scaled by mid-band energy. Same song always produces the same track.
- **Banking** — road rolls into turns. Free drama, one line of math.
- **Geometry** — one `TubeGeometry`-style extrusion along a `CatmullRomCurve3`. Single
  mesh, single draw call. Emissive lane lines in the shader, not as separate objects.
- **Speed** — proportional to downhill slope, clamped. This is the Audiosurf soul:
  the song's dynamics become the throttle.

### Rendering & performance

- `EffectComposer` → RenderPass → UnrealBloomPass (half-res) → vignette/chromatic
- Particles as `THREE.Points` + custom `ShaderMaterial`, animated purely by a `uTime`
  uniform against pre-baked attribute buffers. Thousands of particles, ~zero CPU.
- Roadside architecture via `InstancedMesh`, pulsed by writing to an instance color
  attribute on beats.
- DPR capped at 2. FPS probed over the first 2 seconds → quality tier auto-selected
  (bloom resolution, particle budget, instance draw distance).
- Fog to hide the draw distance cutoff, colored from the song palette.

### File layout

```
src/
  main.js              entry + game state machine
  audio/fft.js         radix-2 FFT
  audio/analyze.js     PCM → SongMap  (runs in worker)
  audio/worker.js
  audio/palette.js     spectral character → color theme
  game/track.js        SongMap → curve + mesh
  game/vessel.js       player craft, movement, camera rig
  game/blocks.js       collectibles, instanced
  game/scoring.js      combo, multiplier, overdrive
  fx/particles.js      thrust, streaks, bursts
  fx/environment.js    roadside instanced architecture
  fx/post.js           composer setup + quality tiers
  ui/screens.js        drop zone, loading, results
  ui/hud.js            score, combo, overdrive, song progress
```

---

## Part 3 — Feature list

### Core (v1)
- Drag-and-drop anywhere on page + file picker (mp3/wav/ogg/flac/m4a)
- Offline analysis with animated loading screen
- Procedural track from song
- Hover vessel, lane movement, slope-driven speed
- Collectible blocks on onsets
- Score, combo, multiplier
- Results screen: song energy graph with your performance overlaid
- Pause / restart / load new song

### The "make it feel expensive" layer
- **Song-derived palette** — every track looks different. Highest impact per line of
  code in the whole project.
- **Beat-synced roadside architecture** — pillars/arches firing on the beat
- **Bloom that responds to combo** — threshold drops as combo climbs, so the world
  visibly overloads when you're doing well
- **FOV punch + camera shake** on beats and boosts
- **Thrust flare on bass hits**
- **Speed streaks** stretching with velocity
- **Collection bursts** in the block's own color

### Worth adding (my recommendations)
- **Overdrive meter** — fill by collecting, spend for a speed burst + visual overload.
  Gives the player agency beyond left/right, and creates a decision: bank it for the
  chorus or spend it now?
- **Hazard blocks** — grey/red, must be dodged, breaks combo. Tension. Density scales
  with difficulty.
- **Difficulty = lane count** (3 lanes / 5 lanes) + block density
- **Intro skip** — seek past quiet lead-ins
- **A bundled procedurally-generated demo track** so the game isn't an empty file
  picker on first load

### Explicitly out of scope
- Multiplayer, online leaderboards (needs a backend)
- Mobile touch controls (desktop-first; revisit later)
- **Spotify/streaming integration — technically impossible.** Streaming APIs do not
  expose raw PCM to the browser. Local files only. Worth stating plainly up front.

---

## Part 4 — Build order

1. ✅ Vite + three scaffold, resize handling, graphics tiers
2. ✅ File drop → decode → FFT → SongMap (worker)
3. ✅ Track curve + mesh from SongMap
4. ✅ Vessel + steering + slope-driven speed
5. ✅ Blocks + hazards + collection + scoring
6. ✅ Post-processing (bloom, grade) and palette derivation
7. ✅ Particles (bursts, dust) + nebula/star environment
8. ✅ UI screens, HUD, results graph
9. ✅ Overdrive, hazards, difficulty presets
10. ✅ Verified at 1366×768

11. ✅ Beat-synced roadside pillars
12. ✅ Difficulty selector (easy / normal / hard)
13. ✅ Intro skip for quiet lead-ins
14. ✅ Mouse steering via pointer lock; overdrive reworked as a reach beam

### Still open

- Touch controls — **dropped**. Pointer lock is now the primary control scheme,
  so a touch port would be a different game rather than an addition.
- Nothing else outstanding from the original design.

---

## Part 5 — Problems hit while building, and why the fixes are what they are

Recording these because each one has a non-obvious cause that would be easy to
"fix" the wrong way later.

**The road folded through itself.** Elevation is derived from energy, and energy
can jump much faster than the craft travels forward — producing near-vertical
track segments. At those the orientation frame (`right = tangent × worldUp`)
degenerates, and the ribbon twists. Fixed by clamping the gradient to a fixed
rise-over-run ratio in a forward *and* backward pass, then smoothing the corners
the clamp leaves behind. Lowering `HEIGHT_SCALE` alone would not have fixed it —
a steep enough transient still degenerates the frame.

**The road looked like a pile of crossing translucent planes.** Not geometry
corruption — the centerline was verified smooth. The ribbon is one long mesh with
`depthWrite: false`, so every section of road further along the song drew straight
through the section in front of the camera.

**Turning depth writing on then punched holes in the road.** A translucent surface
that writes depth occludes everything behind it while remaining invisible itself.
Resolved by making the road genuinely opaque near the camera and only fading it
out at fog distance, where nothing is behind it but sky.

**Hazards were far rarer than the difficulty settings claimed.** Placement gated
them behind `onset.strength < 0.55`, intending to keep the strong beats
collectible. But on a punchy track almost every onset clears 0.55, so the actual
rate was a small fraction of the configured one — 1 / 4 / 9 hazards across
easy / normal / hard where the rates implied 8% / 16% / 26% of ~160 blocks. The
gate is now a weighting rather than a cutoff (`rate * (1.4 - strength * 0.8)`),
which preserves the bias toward weaker onsets while actually hitting the target
rate: 5 / 15 / 35 hazards per minute.

**Collecting a note felt like nothing happened.** The burst particles had been
firing correctly the entire time — they were just invisible. `gl_PointSize` is
`aSize * pixelRatio * (300 / distance)`, and with `aSize` of 0.09–0.22 at the
chase camera's ~21 unit distance that works out to **1–3 pixels**. Sizes are now
0.75–2.85 (10–34px), the burst count went 26 → 53, a shockwave ring was added,
and the block's own pop was shortened to 0.26s with the flash moved to the moment
of contact rather than the fade-out.

Debris also inherits ~82% of the craft's velocity. Without that the vessel
outruns its own explosion in about two frames at 60 u/s and the burst is behind
you before you register it.

**Mouse steering teleported the craft across the road.** Pointer lock can deliver
a single enormous `movementX` — most reliably on the first event after the lock
engages, where the delta is measured from wherever the OS cursor was sitting.
One of those slams the craft into the far wall. Guarded three ways: the first
event after locking is dropped outright, every event is clamped to 260px, and
`mouseDX` is zeroed across pause/resume so nothing accumulated while paused lands
as a single lurch. The clamp is deliberately **per event, not per frame** — a
genuine fast flick arrives as a dozen separate events and must stay uncapped in
aggregate, which is the entire point of mouse control.

**The loader hung forever at "Decoding audio."** The load pipeline awaited
`requestAnimationFrame` purely to let the loading UI paint, and rAF is suspended
entirely in a background tab. Switching away mid-load stalled it until you came
back. Now raced against a timer (`nextPaint`).

**The vessel was a white blob.** Two causes: a leftover `color.setScalar(1)` was
forcing the engine core to pure white every frame, and the camera sits directly
behind the thrust nozzle, so looking straight into an additive plume blows out.
Plume alpha and core size came down; the hull got a dorsal fin because at a ~13°
chase angle a flat craft presents almost no silhouette.
