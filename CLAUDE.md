# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-viewable 3D model of downtown Chicago (Willis Tower, Hancock, Grant Park, river, lakefront, Navy Pier) built with plain Three.js r160. There is no build step, no package.json, no tests and no linter: `index.html` plus ES modules in `js/`, with Three.js loaded from jsDelivr through the import map in `index.html` (`three` and `three/addons/` pinned to `0.160.0`).

## Running it

ES modules won't load from `file://`, so serve the folder over HTTP and open `http://localhost:8080`:

```bash
npx --yes http-server -c-1 -p 8080 .
```

Python isn't installed on this machine; Node is. `.claude/launch.json` defines a `chicago` preview config, but it points at a Node server script in a temporary scratchpad that may no longer exist. Swap in the command above if it fails.

For debugging, `window.__chicago` exposes `{ scene, camera, controls, lighting, flyer, renderer, ctx }`. For example, `__chicago.lighting.set(1)` switches to night. A hidden browser tab throttles `requestAnimationFrame`, so animations and environment-map updates lag there. That's not a bug in the code.

## Publishing

The project is published as a private claude.ai Artifact: https://claude.ai/artifact/FqeJcQo5yP55qtSQfv59HU

To update it, republish `index.html` with every `js/*.js` file mapped in `files` under the same relative path (`js/main.js`, etc.).

Artifact constraints that shape the code:
- Scripts may load only from allowlisted CDNs (jsDelivr is used).
- No external images: all textures are generated on `<canvas>`.
- `index.html` has no `<html>/<head>/<body>` wrapper because the publisher adds one. The local copy therefore runs in quirks mode, which is expected.

It is also public on GitHub Pages at https://srtjairo.github.io/chicago-3d/ (repo `Srtjairo/chicago-3d`, served from `main` → `/docs`). `docs/` is generated, so never edit it by hand. After changing `index.html` or `js/`, rebuild it and push:

```bash
node tools/build-site.mjs https://srtjairo.github.io/chicago-3d/
```

The build wraps `index.html` in a full document (doctype, so the public copy runs in standards mode), adds Open Graph/Twitter link-preview tags and a favicon, and copies `js/` and `preview.png`. `preview.png` (1200×630) is the link-preview image, a dusk shot grabbed from the canvas.

## Architecture

**Coordinates (`js/geo.js`).** Everything is in meters. The origin is State & Madison (the zero point of Chicago's address grid). +X is east, +Z is south, +Y is up. `geo.js` is the single source of truth for real-world data:
- the shoreline polyline (`shoreX(z)`)
- the river branches (`RIVER`, `distToRiver`)
- Grant Park bounds and its plazas
- `LANDMARKS` (position, height, facts, and the camera `view` used for fly-to)
- the zoned height function `heightAt(x,z)`
- the seeded `rng`
- `toAddress()` for the HUD grid readout

Change positions here, not in the builders.

**Adding landmarks.** Use the `architect` subagent (`.claude/agents/architect.md`), which researches, models, registers and verifies a real building. A landmark needs exactly four edits:
1. an entry in `LANDMARKS` (`geo.js`)
2. a builder function in `landmarks.js`
3. a line in its `builders` map
4. its id in `TOUR` (`tour.js`)

The list, labels and info card are data-driven.

**Build pipeline (`js/main.js`).** `init()` creates the renderer, camera and OrbitControls, then calls the builders in order:

`buildTerrain → buildLandmarks → buildCity → (rebuildBeacons) → buildParks → buildNavyPier → Lighting`

It then sets up the CSS2D labels and the UI, and runs the render loop through an `EffectComposer` (RenderPass → UnrealBloomPass → OutputPass). Builders share a `ctx` object that carries cross-module state:
- `ctx.quality`: settings tuned per device
- `ctx.beacons`: Vector3 positions of red aviation lights. `buildCity` adds more, which is why `main.js` rebuilds the beacon InstancedMesh afterwards.
- `ctx.glows`: `{ mat, day, night }` entries; `emissiveIntensity` is interpolated by time of day
- `ctx.updaters`: per-frame callbacks `(time, night)` for the fountain spray and the Ferris wheel
- `ctx.water`, `ctx.riverNormals`, `ctx.streetLights`, `ctx.bloom`, `ctx.parkRects`

**Facade shader (`js/textures.js` → `facadeMaterial`).** Every building, landmarks and the instanced filler city alike, uses a `MeshStandardMaterial` patched with `onBeforeCompile`. It draws windows procedurally from world position and normal, so geometry needs no UVs.
- Distant windows are averaged using `fwidth`. At night they switch to coarse lit "groups" so the city sparkles instead of glowing flat.
- The shared uniform `uNight` (0 = day, 1 = night) drives lit windows.
- The instanced filler city uses `instanced: true`, which reads a per-instance `aStyle` attribute (0 masonry, 1 curtain wall) and `gl_InstanceID` as the seed. This needs WebGL2.

**Filler city (`js/city.js`).** Walks the 125 m street grid (`BLOCK`, `STREET`). It skips cells in the lake, in Grant Park, on Navy Pier, or near the river, and trims blocks that touch the river. Each remaining cell gets a sidewalk slab; cells holding a landmark get only the slab. Filler buildings are emitted into one InstancedMesh (a single draw call). The street-light Points are built from the same blocks plus `ctx.parkRects`.

**Lighting (`js/lighting.js`).** Time of day is one scalar, `t ∈ [0,1]`, interpolated across `KEYS` keyframes: sun elevation and azimuth, light colors and intensities, exposure, fog, `night`, bloom strength, sky parameters, water color, and `env`. `PRESETS` maps the UI chips to `t` values.
- The visible sky is three.js `Sky`, with its fragment shader patched to add `uGain` and night horizon/zenith tints.
- Reflections (`scene.environment`) do not come from the Sky. They come from a separate gradient-dome scene (`makeEnvDome`) run through PMREM, regenerated at most every 0.25 s when `envDirty`. A sky-based environment map kept the scene bright at night.
- The sun's shadow camera follows the orbit target, snapped to 40 m steps.

**Water.** Lake Michigan uses the three.js `Water` addon. Its fragment shader is patched to replace a constant grey reflection term with `waterColor`. The river is a separate MeshStandardMaterial strip with a scrolling normal map.

**Camera & tour (`js/tour.js`).**
- `Flyer` handles fly-to animations and the guided tour (the `TOUR` id list).
- `viewFor(L)` derives the camera position from a landmark's `view: { az, dist, el }`.
- `overviewPos(aspect)` pulls the camera back on portrait screens.
- Any pointerdown on the canvas cancels a flight or tour.

**UI.** All DOM is static in `index.html`; `setupUI()` in `main.js` wires it up. The page is single-theme dark: CSS tokens on `:root`, fonts Big Shoulders Display, Barlow and IBM Plex Mono. At widths of 720 px and below, the landmark panel becomes a toggled sheet.
