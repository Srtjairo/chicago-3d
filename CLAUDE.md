# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-viewable 3D model of downtown Chicago built with plain Three.js r160. There is no package.json or linter: `index.html` plus ES modules in `js/`. `tools/build-site.mjs` makes the public copy; `node tools/check.mjs` checks river geometry, landmark views and deployed dependency versions. Three.js loads from jsDelivr through the import map (`three` and `three/addons/` pinned to `0.160.0`).

## Running it

ES modules won't load from `file://`, so serve the folder over HTTP and open `http://localhost:8080`:

```bash
node tools/serve.mjs 8080
```

Python isn't installed on this machine; Node is. `.claude/launch.json` (gitignored) has three preview configs:
- `chicago`: the source on port 8080
- `site`: the built `docs/` on port 8081
- `capture`: port 8082, a scratchpad Node server with a `POST /__save` endpoint that was used to save canvas frames for `preview.png`. Its script lives in a temporary scratchpad and may be gone.

For debugging, `window.__chicago` exposes `{ scene, camera, controls, lighting, flyer, renderer, ctx, perf }`. For example, `__chicago.lighting.set(1)` switches to night.

A hidden browser tab throttles `requestAnimationFrame`, so animations and environment-map updates lag there. That's not a bug in the code. The Claude app's browser pane can also stop delivering frames entirely while a long `javascript_tool` script blocks the page, so don't benchmark with busy-loops there.

**Adaptive quality (`perf`, `adaptiveQuality()` in `main.js`).** Under ~45 fps for two one-second windows it steps down one tier; under ~25 fps it drops two. The five tiers lower pixel ratio, slow lake reflections from every second to every fourth frame, reduce shadow resolution, and finally drop MSAA and UI blur.
- It steps up after eight consecutive windows above 57 fps, including on 60 Hz screens.
- Hidden or unfocused tabs are ignored. Software renderers start at the lowest tier and show the graphics-acceleration notice.
- Desktop starts with 2048 shadows, 512 reflections and 2x MSAA; phones use 1024 shadows and 256 reflections. Shadows are cached and refreshed only when the light or snapped focus changes. Trees, filler buildings and Marina City's balcony plates do not cast shadows.
- Bloom and stars were removed. Fountain spray has 184 points, updated at most 30 times per second; street lights are sparse and confined to the central area. Prefer static instanced detail over additional effects.
- `perf.gpu` holds the GPU string and `perf.level` the tier. Setting `perf.level` (0–4) pins that tier; `perf.auto = true` hands control back.
- The frame step is capped at 0.1 s and OrbitControls damping is rescaled by `dt`, so motion stays real-time down to 10 fps. Below that cap, low fps shows as slow motion rather than choppiness.
- On the user's RTX 4070 the site runs at 110–145 fps at full quality. If it lags in their own browser, check `perf.gpu`: Windows may be running the browser on integrated graphics.

**`?debug` panel.** Adding `?debug` shows fps, frame time, JS time, tier, canvas size, draw calls, triangles and GPU. Switches isolate MSAA, shadows, lake reflection, UI blur, labels, filler city and window shading. Only compare performance with foreground tabs, matching views and quality tiers; cached reflection/shadow frames have different draw counts.

## Publishing

**Public site (primary).** https://srtjairo.github.io/chicago-3d/ is GitHub Pages for the public repo `Srtjairo/chicago-3d`, served from `main` → `/docs`.
- `docs/` is generated, so never edit it by hand.
- Commits use the `Srtjairo <Srtjairo@users.noreply.github.com>` identity, set in the local repo config. Git Credential Manager already holds the GitHub login, so `git push` works without prompts.
- `gh` (GitHub CLI) is not installed. Repo settings such as Pages are changed through github.com in the browser.

After changing `index.html` or `js/`, rebuild, commit and push. Pages redeploys in about a minute and the URL never changes:

```bash
node tools/build-site.mjs https://srtjairo.github.io/chicago-3d/
```

The build:
- wraps `index.html` in a full document (doctype, so the public copy runs in standards mode)
- adds Open Graph/Twitter link-preview tags and a favicon
- copies `js/` and `preview.png`
- versions the entry module, every relative module dependency and the preview URL with a source/content hash; `docs/revision.json` identifies the deployed release

Run `node tools/check.mjs` after building. For visual QA, serve the repo and open `/tools/review.html`; it supports phone sizing, fixed camera/light presets, geometry checks and a local-only PNG capture endpoint for the link preview.

`preview.png` (1200×630) is the link-preview image: a dusk shot (`lighting.set(0.64)`, camera pulled in and lowered from the overview) grabbed from `renderer.domElement` inside a `requestAnimationFrame`, then downscaled on a 2D canvas.

`share/` (untracked) holds the drafted email and text message used to share the link.

**claude.ai Artifact (secondary).** A private copy lives at https://claude.ai/artifact/FqeJcQo5yP55qtSQfv59HU. It does not update when the site is pushed. To update it, republish `index.html` with every `js/*.js` file mapped in `files` under the same relative path (`js/main.js`, etc.).

Constraints that shape the code (they come from the artifact and keep both copies working):
- Scripts may load only from allowlisted CDNs (jsDelivr is used).
- No external images: all textures are generated on `<canvas>`.
- `index.html` has no `<html>/<head>/<body>` wrapper because the publisher adds one. The local copy therefore runs in quirks mode, which is expected; the build script adds the wrapper for Pages.

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

`buildTerrain → buildLandmarks → buildCity → buildStreets → (rebuildBeacons) → buildParks → buildNavyPier → Lighting`

It sets up collision-avoiding CSS2D labels and the UI, and renders through `EffectComposer` (RenderPass → OutputPass). Builders share a `ctx` object:
- `ctx.quality`: settings tuned per device
- `ctx.beacons`: Vector3 positions of red aviation lights. `buildCity` adds more, which is why `main.js` rebuilds the beacon InstancedMesh afterwards.
- `ctx.glows`: `{ mat, day, night }` entries; `emissiveIntensity` is interpolated by time of day
- `ctx.updaters`: per-frame callbacks `(time, night)` for the fountain spray and the Ferris wheel
- `ctx.water`, `ctx.riverNormals`, `ctx.streetLights`, `ctx.parkRects`, `ctx.bridges`, `ctx.cityBoxes`

**Facade shader (`js/textures.js` → `facadeMaterial`).** Every building, landmarks and the instanced filler city alike, uses a `MeshStandardMaterial` patched with `onBeforeCompile`. It draws windows procedurally from world position and normal, so geometry needs no UVs.
- Seeds are quantized before hashing to avoid interpolated-seed noise. Distant windows converge to their area average using `fwidth`; nearby night windows light in office groups.
- The shared uniform `uNight` (0 = day, 1 = night) drives lit windows.
- The instanced filler city uses `instanced: true`, which reads a per-instance `aStyle` attribute (0 masonry, 1 curtain wall) and `gl_InstanceID` as the seed. This needs WebGL2.

**Filler city (`js/city.js`).** Walks the 125 m street grid (`BLOCK`, `STREET`). It skips cells in the lake, in Grant Park, on Navy Pier, or near the river, and trims blocks that touch the river. Each remaining cell gets a sidewalk slab; cells holding a landmark get only the slab. Filler buildings are emitted into one InstancedMesh (a single draw call). The street-light Points are built from the same blocks plus `ctx.parkRects`.

**Lighting (`js/lighting.js`).** Time of day is one scalar, `t ∈ [0,1]`, interpolating sun direction, light colors/intensities, exposure, fog, night, sky, water and environment strength. `PRESETS` maps the UI chips to `t` values.
- The visible sky uses a lightweight gradient shader with a small analytic sun. Its horizon matches the fog color, avoiding a hard seam at the finite terrain edge.
- Environment reflections use a gradient dome plus one merged batch of simplified nearby building silhouettes, baked through PMREM at most every 0.5 s when time changes. There is no live cube camera. The silhouettes are approximate reflections, not an exact scene capture.
- The sun's shadow camera follows the orbit target, snapped to 40 m steps.

**Water.** Lake Michigan uses the three.js `Water` addon. Its fragment shader is patched to replace a constant grey reflection term with `waterColor`. The river is a separate MeshStandardMaterial strip with a scrolling normal map.

**Camera & tour (`js/tour.js`).**
- `Flyer` handles fly-to animations and the guided tour (the `TOUR` id list).
- `viewFor(L)` derives the camera position from a landmark's `view: { az, dist, el }`.
- `overviewPos(aspect)` pulls the camera back on portrait screens.
- Any pointerdown on the canvas cancels a flight or tour.

**UI.** All DOM is static in `index.html`; `setupUI()` in `main.js` wires it up. The page is single-theme dark: CSS tokens on `:root`, fonts Big Shoulders Display, Barlow and IBM Plex Mono. At widths of 720 px and below, the landmark panel becomes a toggled sheet.
