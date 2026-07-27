import * as THREE from 'three'
import { makeFrame } from '../game/track.js'

/**
 * Two raymarched 4D hypercubes flanking the track.
 *
 * The 4D machinery here is a port of Digi/Tesseract, written by Claude Fable
 * for VRChat (see `Fable backrooms/VRChat_Tesseract/Digi_Tesseract.shader`).
 * The rotation planes, the 4D->3D perspective projection, the edge/vertex SDF
 * and the "hue encodes the w coordinate" idea are all from that shader; this
 * is a translation from Unity HLSL to GLSL plus the plumbing to place two of
 * them alongside a moving track.
 *
 * What you're looking at is the 3D shadow of a real tesseract rotating in four
 * dimensions -- the inner cube folds through the outer cube and turns itself
 * inside out. It isn't an animation; 16 four-dimensional vertices are rotated
 * and projected every frame.
 *
 * Changes from the original:
 *   - The Unity per-eye stereo handling and SV_Depth writes are dropped; these
 *     are distant background objects on a flat screen.
 *   - Fold and spin angles are accumulated on the CPU so the song's bass can
 *     drive the fold speed without the phase jumping when the rate changes.
 *     (Fable's README suggested exactly this via AudioLink.)
 *   - Colours come from the song's derived palette.
 */

// Placed ahead of the craft, not level with it. Directly to the side puts them
// ~70 degrees off-axis, outside the camera's ~68 degree field of view -- they
// have to sit down-track to be seen at all.
const LOOKAHEAD = 2.2 // seconds of track ahead
const SIDE_DISTANCE = 40 // units out from the track centre
const HEIGHT = 18 // units above the road
const SIZE = 30 // world size of the containing volume

export class Tesseracts {
  constructor(scene, palette, settings) {
    this.scene = scene
    this.enabled = (settings.tesseractSteps ?? 0) > 0
    this.meshes = []
    this.frame = makeFrame()
    this.foldTime = 0
    this.spinTime = 0

    if (!this.enabled) return

    const geometry = new THREE.BoxGeometry(1, 1, 1)

    for (let i = 0; i < 2; i++) {
      const material = createTesseractMaterial(palette, settings.tesseractSteps)
      // Give the two a different phase so they never mirror each other.
      material.uniforms.uPhase.value = i === 0 ? 0 : 2.4
      const mesh = new THREE.Mesh(geometry, material)
      mesh.scale.setScalar(SIZE)
      mesh.frustumCulled = false
      mesh.renderOrder = -5 // behind the road and blocks, in front of the sky
      scene.add(mesh)
      this.meshes.push(mesh)
    }
  }

  /**
   * @param {import('../game/track.js').Track} track
   * @param {number} songTime
   * @param {number} dt
   * @param {number} bass  0..1
   */
  update(track, songTime, time, dt, bass) {
    if (!this.enabled) return

    // Sampled ahead so they hold station down-track and stay in frame as the
    // road curves, reading as fixed landmarks rather than attached props.
    const frame = track.sample(songTime + LOOKAHEAD, this.frame)

    // Accumulated rather than derived from `time * speed`, so a bass swell can
    // accelerate the fold without the phase snapping.
    this.foldTime += dt * (0.35 + bass * 0.75)
    this.spinTime += dt * (0.30 + bass * 0.25)

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1
      const mesh = this.meshes[i]

      mesh.position
        .copy(frame.position)
        .addScaledVector(frame.right, side * SIDE_DISTANCE)
        .addScaledVector(frame.up, HEIGHT)

      const u = mesh.material.uniforms
      u.uCenter.value.copy(mesh.position)
      u.uFoldTime.value = this.foldTime
      u.uSpinTime.value = this.spinTime
      u.uTime.value = time
      u.uBass.value = bass
    }
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      this.scene.remove(mesh)
    }
    this.meshes.length = 0
  }
}

function createTesseractMaterial(palette, steps) {
  return new THREE.ShaderMaterial({
    // Deliberately plain GLSL ES 1.00. The original walks the bits of the
    // vertex index, which would want GLSL3 -- but three.js doesn't provide
    // `gl_FragColor` under GLSL3, so the bit maths is done in floats instead
    // and this compiles as an ordinary ShaderMaterial.
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide, // single layer of coverage, valid from inside or out
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, // the shader outputs premultiplied alpha
    blendDst: THREE.OneMinusSrcAlphaFactor,
    defines: { STEPS: steps },
    uniforms: {
      uTime: { value: 0 },
      uFoldTime: { value: 0 },
      uSpinTime: { value: 0 },
      uPhase: { value: 0 },
      uBass: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uSize: { value: SIZE },
      // Kept near 1.0 rather than pushed into HDR. Cranked up, bloom clips the
      // edges to white and you lose the hue gradient -- which is the whole
      // point, since hue is what encodes each edge's 4th-dimension coordinate.
      uColorA: { value: new THREE.Color(palette.accent).multiplyScalar(1.15) },
      uColorB: { value: new THREE.Color(palette.secondary).multiplyScalar(1.15) },
      uProj4D: { value: 3.0 },
      uScale: { value: 0.16 },
      uThickness: { value: 0.008 },
      uVertRadius: { value: 0.02 },
      uRainbow: { value: 0.35 },
      uHueScroll: { value: 0.15 },
      uGlowIntensity: { value: 1.4 },
      uGlowSharp: { value: 20000.0 },
      uOpacity: { value: 0.85 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec3 vWorld;

      uniform float uTime, uFoldTime, uSpinTime, uPhase, uBass;
      uniform vec3 uCenter;
      uniform float uSize;
      uniform vec3 uColorA, uColorB;
      uniform float uProj4D, uScale, uThickness, uVertRadius;
      uniform float uRainbow, uHueScroll;
      uniform float uGlowIntensity, uGlowSharp, uOpacity;

      // Projected 3D vertex positions, and the pre-projection w of each, which
      // is what the colour encodes.
      vec3 gVerts[16];
      float gW[16];

      // --- 4D rotation. XW is the main fold; YW runs at an incommensurate
      // rate so the motion never exactly repeats; ZW is a slow drift.
      vec4 rotate4D(vec4 p, float t) {
        float c = cos(t), s = sin(t);
        p = vec4(c * p.x - s * p.w, p.y, p.z, s * p.x + c * p.w);

        c = cos(t * 0.6180339); s = sin(t * 0.6180339);
        p = vec4(p.x, c * p.y - s * p.w, p.z, s * p.y + c * p.w);

        c = cos(t * 0.31); s = sin(t * 0.31);
        p = vec4(p.x, p.y, c * p.z - s * p.w, s * p.z + c * p.w);
        return p;
      }

      void buildVerts() {
        float tFold = (uFoldTime + uPhase) * 2.0;
        float aSpin = uSpinTime * 2.0;
        float cs = cos(aSpin), ss = sin(aSpin);
        float ct = cos(0.4), st = sin(0.4); // fixed tilt so three faces read

        for (int i = 0; i < 16; i++) {
          // The 16 vertices are (+-1, +-1, +-1, +-1) -- i.e. the bits of i.
          // Extracted with float maths so this stays GLSL ES 1.00.
          float fi = float(i);
          vec4 v = vec4(
            mod(fi, 2.0),
            mod(floor(fi / 2.0), 2.0),
            mod(floor(fi / 4.0), 2.0),
            mod(floor(fi / 8.0), 2.0)
          ) * 2.0 - 1.0;

          vec4 r = rotate4D(v, tFold);

          // 4D -> 3D perspective projection: divide by the 4th axis exactly as
          // a camera divides by z. Vertices swinging toward w = +uProj4D grow,
          // ones swinging away shrink. That is the fold.
          float k = uProj4D / (uProj4D - r.w);
          vec3 q = r.xyz * k * uScale;

          q.xz = vec2(cs * q.x - ss * q.z, ss * q.x + cs * q.z);
          q.yz = vec2(ct * q.y - st * q.z, st * q.y + ct * q.z);

          gVerts[i] = q;
          gW[i] = r.w;
        }
      }

      // Capsule distance to one edge, folded into the running minimum.
      void edge(vec3 p, vec3 a, vec3 b, float wa, float wb,
                inout float d, inout float hue) {
        vec3 pa = p - a;
        vec3 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float dl = length(pa - ba * h) - uThickness;
        if (dl < d) {
          d = dl;
          hue = mix(wa, wb, h) * 0.25 + 0.5;
        }
      }

      // --- SDF over 32 edges + 16 vertex nodes.
      float map(vec3 p, out float hue) {
        float d = 1e5;
        hue = 0.5;

        for (int i = 0; i < 16; i++) {
          vec3 a = gVerts[i];

          float dv = length(p - a) - uVertRadius;
          if (dv < d) { d = dv; hue = gW[i] * 0.25 + 0.5; }

          // Each vertex owns the edges toward its 0->1 bit flips, which
          // enumerates all 32 edges exactly once. Where a bit is 0, setting it
          // is the same as adding it, so the neighbour index is i + 1/2/4/8 --
          // and that keeps every array index a constant-index-expression.
          float fi = float(i);
          if (mod(fi, 2.0) < 0.5)             edge(p, a, gVerts[i + 1], gW[i], gW[i + 1], d, hue);
          if (mod(floor(fi / 2.0), 2.0) < 0.5) edge(p, a, gVerts[i + 2], gW[i], gW[i + 2], d, hue);
          if (mod(floor(fi / 4.0), 2.0) < 0.5) edge(p, a, gVerts[i + 4], gW[i], gW[i + 4], d, hue);
          if (mod(floor(fi / 8.0), 2.0) < 0.5) edge(p, a, gVerts[i + 8], gW[i], gW[i + 8], d, hue);
        }
        return d;
      }

      float mapD(vec3 p) { float h; return map(p, h); }

      vec3 calcNormal(vec3 p) {
        vec2 e = vec2(0.0015, -0.0015);
        return normalize(
          e.xyy * mapD(p + e.xyy) +
          e.yyx * mapD(p + e.yyx) +
          e.yxy * mapD(p + e.yxy) +
          e.xxx * mapD(p + e.xxx)
        );
      }

      vec3 edgeColor(float hue) {
        vec3 duo = mix(uColorA, uColorB, clamp(hue, 0.0, 1.0));
        vec3 rb = (0.5 + 0.5 * cos(6.28318 * (hue + uTime * uHueScroll)
                  + vec3(0.0, 2.094, 4.188))) * 2.0;
        return mix(duo, rb, uRainbow);
      }

      vec2 boxBounds(vec3 ro, vec3 rd) {
        vec3 m = 1.0 / rd;
        vec3 n = m * ro;
        vec3 k = abs(m) * 0.5;
        vec3 t1 = -n - k;
        vec3 t2 = -n + k;
        return vec2(max(max(t1.x, t1.y), t1.z), min(min(t2.x, t2.y), t2.z));
      }

      void main() {
        buildVerts();

        // The raymarch runs in the volume's local space, where the box is +-0.5.
        vec3 ro = (cameraPosition - uCenter) / uSize;
        vec3 rd = normalize((vWorld - uCenter) / uSize - ro);

        vec2 bounds = boxBounds(ro, rd);
        float t = max(bounds.x, 0.0);

        float glow = 0.0;
        float bestD = 1e5, bestHue = 0.5, hitHue = 0.5;
        bool hit = false;

        float glowGain = uGlowIntensity * (1.0 + uBass * 1.1);

        for (int s = 0; s < STEPS; s++) {
          vec3 p = ro + rd * t;
          float hue;
          float d = map(p, hue);

          if (d < bestD) { bestD = d; bestHue = hue; }
          glow += glowGain * 0.06 / (1.0 + d * d * uGlowSharp);

          if (d < 0.0008) { hit = true; hitHue = hue; break; }
          t += d;
          if (t > bounds.y) break;
        }

        vec3 glowCol = edgeColor(bestHue) * min(glow, 2.0);

        if (hit) {
          vec3 p = ro + rd * t;
          vec3 n = calcNormal(p);
          vec3 ec = edgeColor(hitHue);

          vec3 l = normalize(vec3(0.5, 0.8, -0.4));
          float diff = clamp(dot(n, l), 0.0, 1.0) * 0.35 + 0.65;
          float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
          float spec = pow(clamp(dot(reflect(rd, n), l), 0.0, 1.0), 32.0);

          vec3 col = ec * diff + ec * fres * 1.5 + spec * 0.6 + glowCol * 0.4;
          gl_FragColor = vec4(col * uOpacity, uOpacity);
          return;
        }

        float a = clamp(glow, 0.0, 1.0) * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(glowCol * a, a); // premultiplied
      }
    `,
  })
}
