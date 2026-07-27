import * as THREE from 'three'

/**
 * The road is the one piece of hard, legible geometry in an otherwise soft
 * cosmic world -- that contrast is what keeps the game readable at speed.
 *
 * Everything here is drawn from UVs: u runs across the road (0..1), v carries
 * the song time in seconds at that point. So the shader always knows both
 * where it is across the track and how far ahead of the playhead it is.
 */
export function createRoadMaterial(palette) {
  return new THREE.ShaderMaterial({
    transparent: true,
    // Depth writing is essential: the ribbon is one long winding mesh, so
    // without it every section of road further along the song draws straight
    // through the section in front of you and the track reads as a pile of
    // crossing planes.
    //
    // But a *translucent* surface that writes depth punches invisible holes in
    // whatever is behind it. So the road is fully opaque near the camera and
    // only fades out at fog distance, where there's nothing behind it but sky.
    depthWrite: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 }, // current song time
      uLaneCount: { value: 5 },
      uPrimary: { value: new THREE.Color(palette.primary) },
      uAccent: { value: new THREE.Color(palette.accent) },
      uSecondary: { value: new THREE.Color(palette.secondary) },
      uFogColor: { value: new THREE.Color(palette.fog) },
      uFogNear: { value: 120 },
      uFogFar: { value: 620 },
      uCombo: { value: 0 }, // 0..1, drives how hot the road runs
      uBeat: { value: 0 }, // 0..1, decays after each beat
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vEnergy;
      varying float vFogDepth;

      attribute float aEnergy;

      void main() {
        vUv = uv;
        vEnergy = aEnergy;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;
      varying float vEnergy;
      varying float vFogDepth;

      uniform float uTime;
      uniform float uLaneCount;
      uniform vec3 uPrimary;
      uniform vec3 uAccent;
      uniform vec3 uSecondary;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uCombo;
      uniform float uBeat;

      void main() {
        float u = vUv.x;
        float songT = vUv.y;
        float ahead = songT - uTime;

        // --- surface -------------------------------------------------------
        // A solid but very dark deck. Dark enough to feel ethereal against the
        // nebulae, opaque enough to occlude the track behind it.
        vec3 deck = uFogColor * 1.1 + uPrimary * (0.012 + vEnergy * 0.035);

        // --- edge rails ----------------------------------------------------
        // The brightest thing on the road: defines where the world ends.
        float fromCenter = abs(u * 2.0 - 1.0);
        float rail = smoothstep(0.90, 0.995, fromCenter);
        rail += smoothstep(0.78, 1.0, fromCenter) * 0.10;

        // --- lane dividers -------------------------------------------------
        float lanePos = u * uLaneCount;
        float toDivider = abs(fract(lanePos) - 0.5) * 2.0;
        float divider = smoothstep(0.93, 1.0, toDivider) * 0.30;

        // --- transverse rungs ----------------------------------------------
        // Rungs every 1/6 s of song. They stream toward you as you move, which
        // is most of the sensation of speed.
        float rungPhase = fract(songT * 6.0);
        float rung = smoothstep(0.90, 1.0, abs(rungPhase * 2.0 - 1.0)) * (0.18 + vEnergy * 0.35);

        // --- playhead flare ------------------------------------------------
        // A bright band right where the vessel is, so the contact point reads.
        float flare = exp(-abs(ahead) * 5.0) * 0.30;

        // --- assemble ------------------------------------------------------
        vec3 col = deck;
        col += uPrimary * rung;
        col += uAccent * (rail * (1.1 + uCombo * 1.4 + uBeat * 0.5));
        col += uSecondary * divider;
        col += uAccent * flare;

        // Combo heats the whole surface; this is what makes a good run look
        // visibly different rather than just scoring higher.
        col *= 1.0 + uCombo * 0.75;

        // Opaque up close, dissolving into the nebulae at range so the road
        // never ends on a hard silhouette.
        float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
        col = mix(col, uFogColor, fog * 0.85);
        float alpha = 1.0 - fog;

        // Hide the road behind the starting line.
        if (ahead < -0.9) discard;

        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  })
}
