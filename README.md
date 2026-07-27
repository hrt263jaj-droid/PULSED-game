# PULSEDRIVE

An Audiosurf-style rhythm racer that runs in the browser. Drop in any audio file
from your machine and it builds a track out of that song — hills from the energy,
turns seeded by the track itself, blocks on the beats, and a color palette derived
from the song's own frequency profile.

Built with three.js + Vite, vanilla JS, no external assets.

## Running it

```
npm install      # once
npm run dev      # then open the printed localhost URL
```

`npm run build` produces a static `dist/` you can host anywhere.

## Playing

| Input | Action |
| --- | --- |
| **Mouse** | Steer (click once to take control) |
| `←` `→` or `A` `D` | Steer |
| `Space` **or left click** | Overdrive (when the meter is full) |
| `Esc` | Release the mouse / pause |
| `R` | Restart the song |

**Mouse steering is the primary control.** Click the canvas once when a run
starts and the game takes pointer lock, giving direct 1:1 positional control —
there's no acceleration curve and therefore no top speed, so a fast flick crosses
the whole road in a single frame. Keyboard steering still works and is folded
into the same positional model while locked, but it's capped at ~29 units/sec by
nature and will always be slower than the mouse.

Sensitivity is adjustable in **Graphics**; the default takes ~460px of mouse
travel to sweep the road end to end. `Esc` releases the mouse and pauses.

Collect the glowing diamonds, avoid the jagged dark shards. Combo climbs while
you stay clean and the whole world visibly overloads as it does — bloom
intensifies, the road heats up, the color grade pushes toward the song's accent.

Drop an audio file anywhere on the window to load it, or use **Try demo track**
for a synthesized one.

**Difficulty** is set on the title screen and applies to the next song you load
— lane count and block placement are baked when the track is generated, so it
can't change mid-run.

| | Lanes | Notes | Hazards |
| --- | --- | --- | --- |
| Easy | 3 | sparse | ~5/min |
| Normal | 5 | balanced | ~15/min |
| Hard | 5 | every beat | ~35/min |

**Quiet intros are skipped automatically** (toggleable in Graphics). If a song
opens with more than 4 seconds of ambience, playback starts just before the
music proper. Blocks in the skipped section are retired without counting against
your accuracy.

## How it works

**Everything is decided before you start playing.** The file is decoded to raw
PCM and the whole song is analyzed in a Web Worker — windowed FFT, band energies,
spectral flux onset detection, tempo estimation — producing a `SongMap` that
describes the entire timeline. The track geometry is then generated in one pass
from that map.

This matters because the alternative (`AnalyserNode`, reading the audio live as
it plays) only ever knows the current instant. You would not be able to see the
road ahead of you, and seeing the road ahead is the entire feel of the genre.

**The track is parameterized by song time, not distance.** Frame `i` of the track
is always the geometry at `t = i / 60`, so a block detected at 41.3s sits exactly
where the vessel will be at 41.3s. Audio and geometry cannot drift apart, and
collision is an exact comparison rather than a physics query.

**Speed is emergent.** Loud passages sit *low* — elevation is inverted energy — so
a chorus is a plunge and a breakdown is a climb. Fast sections simply have their
sample points spaced further apart, so travelling one frame per 1/60s covers more
ground there. Nothing is integrated at play time.

**The palette comes from the audio.** The song's energy-weighted spectral centroid
picks a hue arc: bass-heavy tracks land warm and deep, bright airy tracks land
cool and electric. Two different songs produce visibly different worlds from
identical code.

## Layout

```
src/
  main.js              entry, game state machine, camera rig
  audio/
    fft.js             radix-2 FFT, zero allocation in the hot loop
    analyze.js         PCM -> SongMap
    worker.js          runs analyze.js off the main thread
    loader.js          file decode + worker orchestration
    palette.js         spectral character -> color theme
    demoTrack.js       synthesized fallback song
  game/
    track.js           SongMap -> curve + road geometry
    roadMaterial.js    road shader (lanes, rails, rungs, playhead flare)
    blocks.js          collectibles + hazards, instanced
    vessel.js          player craft
    scoring.js         combo, multiplier, overdrive
  fx/
    environment.js     nebula skydome + starfield
    particles.js       collection bursts + ambient dust
    post.js            bloom + color grade
    quality.js         graphics tiers
  ui/screens.js        all DOM handling
```

## Graphics settings

Four tiers (Low / Medium / High / Ultra), reachable from the title screen or the
pause menu, stored in `localStorage`. Defaults to **High**. Changing tiers rebuilds
the post-processing stack, environment and particles live; antialiasing is fixed
at context creation so it applies on the next reload.

## Credits

The two raymarched hypercubes flanking the track are a port of
**Digi/Tesseract**, written by **Claude Fable** for VRChat. The 4D rotation
planes, the 4D→3D perspective projection, the edge/vertex SDF, and the idea of
encoding the `w` coordinate as hue are all from that shader — this project
translates it from Unity HLSL to GLSL and adds the plumbing to place two of them
alongside a moving track.

What you're looking at is the 3D shadow of a real tesseract rotating in four
dimensions: the inner cube folds through the outer cube and turns itself inside
out. It isn't an animation — 16 four-dimensional vertices are rotated and
projected every frame. The colour gradient along each edge tells you how far
away that part is in 4D.

Fable's README suggested driving the fold speed from audio; here the song's bass
does exactly that.

## Notes and limits

- **Local files only.** Spotify and other streaming APIs never expose raw audio
  samples to the browser, so there is no way to analyze a streamed track. This is
  a hard platform limit, not a missing feature.
- **Overdrive doesn't make you faster — it makes you wider.** Speed is locked to
  the song's playback, so a real speed boost would desync the audio. Instead it
  extends a beam out to either side of the craft for 4.5 seconds, more than
  doubling your reach (2.2x) and doubling points.

  The catch: **the beam catches hazards too.** The vertical blades mark the exact
  edge of the collection radius, and that same radius is what makes obstacles
  dangerous. Firing it during a dense drop will wreck your combo; firing it
  across a clean melodic passage sweeps up notes you could never have reached.
  Deciding *when* to spend it is the whole mechanic — an earlier version
  exempted hazards, which made it a freebie with no decision attached.

- **Hazards are black, never coloured.** Colour is reserved entirely for things
  worth collecting, so a hazard can't be confused with a note whatever palette
  the song generates. Their jagged silhouette and cold outline carry the read.
- Codec support depends on the browser. Chrome handles mp3/wav/ogg/flac/m4a;
  exotic files may fail to decode and will report an error rather than hanging.
- Desktop-first. There are no touch controls yet.
