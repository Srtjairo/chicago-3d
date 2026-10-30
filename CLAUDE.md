# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-viewable 3D model of downtown Chicago built with plain Three.js r160. There is no package.json or linter: `index.html` plus ES modules in `js/`, and bundled geographic data in `assets/`. `tools/build-site.mjs` makes the public copy; `node tools/check.mjs` checks river geometry, landmark views and deployed dependency versions. `node tools/check-city.mjs` validates the geographic data, movement math and signal clearance. Three.js loads from jsDelivr through the import map (`three` and `three/addons/` pinned to `0.160.0`). See `SOURCES.md` for data provenance and limitations.

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
- Measure the current release in `/tools/review.html` with a foreground tab. Earlier performance measurements do not apply to the expanded city. MacBook and physical phone performance have not been measured. Mobile quality targets a stable 30 fps; desktop adapts below 45 fps.
- Downtown footprints are merged by material and 600 m spatial cell. Far cells use box proxies; cornices and roof details are culled by distance. Vehicles and pedestrians use pooled instanced meshes, a 20 Hz simulation and interpolated presentation. City life adds no dynamic shadow casters.

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
- copies `js/`, `assets/` and `preview.png`
- versions the entry module, every relative module dependency and the preview URL with a source/content hash; `docs/revision.json` identifies the deployed release

Run `node tools/check.mjs`, `node tools/check-city.mjs`, `node tools/check-waterfront.mjs` and `node tools/check-sites.mjs` after building. For visual QA, serve the repo and open `/tools/review.html`; it supports phone sizing, every landmark/district view, geometry checks, a 90-second motion audit, three warmed frame-time samples per view and a local-only PNG capture endpoint for the link preview. Rebuild after saving the preview, since the image is included in the release hash.

`preview.png` (1200×630) is the link-preview image: the overview at dusk (`lighting.set(0.6)`), rendered and captured using the review page.

`share/` (untracked) holds the drafted email and text message used to share the link.

**claude.ai Artifact (secondary).** A private copy lives at https://claude.ai/artifact/FqeJcQo5yP55qtSQfv59HU. It does not update when the site is pushed. To update it, republish `index.html` with every `js/*.js` file mapped in `files` under the same relative path (`js/main.js`, etc.).

Constraints that shape the code (they come from the artifact and keep both copies working):
- Scripts may load only from allowlisted CDNs (jsDelivr is used).
- No external images: all textures are generated on `<canvas>`.
- `index.html` has no `<html>/<head>/<body>` wrapper because the publisher adds one. The local copy therefore runs in quirks mode, which is expected; the build script adds the wrapper for Pages.

## Architecture

**Coordinates (`js/geo.js`).** Everything is in meters. The origin is State & Madison (the zero point of Chicago's address grid). +X is east, +Z is south, +Y is up. `geo.js` holds curated landmark data and the surrounding procedural city. `assets/downtown.json` holds measured downtown footprints, road centerlines and water polygons. At startup `configureShore()` derives the downtown lake edge from that data. `geo.js` also contains:
- the shoreline polyline (`shoreX(z)`)
- the river branches (`RIVER`, `distToRiver`)
- Grant Park bounds and its plazas
- `LANDMARKS` (position, height, facts, and the camera `view` used for fly-to)
- the zoned height function `heightAt(x,z)`
- the seeded `rng`
- `toAddress()` for the HUD grid readout

Change positions here, not in the builders.

**Adding landmarks.** Research, model, register and visually verify the building. A landmark needs:
1. an entry in `LANDMARKS` (`geo.js`)
2. a builder in `landmarks.js`, `architecture.js` or `offices.js`
3. registration in that builder's map/list, and its corresponding source footprint ID in `footprintIds` on the landmark (automatically included in `REPLACED` by `city-data.js`) so the measured mass does not overlap it
4. explicit `collision` bounds for low buildings that would otherwise fall below the 100 m collision cutoff

Only add a landmark to `TOUR` when requested. Relativity and OnDean are intentionally selectable only; preserve the existing 18-stop itinerary. Optional `facts` replaces the normal height/year/address card fields; optional `listMeta` supplies a list subtitle without requiring `ft` or `year`. `labelSubtitle` and `labelOffset` customize the scene tag. A view can set a local `focus` offset, facade sampling `width` and collision `clearance` for narrow street-canyon views; other landmarks retain the original camera behavior.

The list, labels and info card are data-driven.

**Build pipeline (`js/main.js`).** `init()` creates the renderer, camera and OrbitControls, then calls the builders in order:

`loadCityData → loadWaterfront → loadSites → loadTransit → configureShore → prepareWorld → buildTerrain → buildWaterGeometry → buildLandmarks → buildSignatureArchitecture → buildOfficeArchitecture → buildCity → buildStreets → buildSites → rebuildBeacons → buildParks → buildWaterfront → buildNavyPier → buildCityLife → buildTransit → Lighting → setupExplorer → setupTransitExplorer`

`assets/waterfront.json` is the shared landscape, exclusion, map and route dataset. Generate it with `node tools/build-waterfront.mjs`; southern Grant Park geometry comes from `tools/south-grant.mjs`. `assets/sites.json` is generated by `node tools/build-sites.mjs` and records explicit source-footprint replacements, parcel surfaces, building parts, parked spaces and routes. `siteVolumes()` supplies separate low podium collisions. Add routes through the shared registry rather than replacing another builder's paths. Night facade profiles and source-ID seeds must match measured buildings and their distant instanced substitutes.

It sets up collision-avoiding CSS2D labels and the UI, and renders through `EffectComposer` (RenderPass → OutputPass). Builders share a `ctx` object:
- `ctx.quality`: settings tuned per device
- `ctx.beacons`: Vector3 positions of red aviation lights. `buildCity` adds more, which is why `main.js` rebuilds the beacon InstancedMesh afterwards.
- `ctx.glows`: `{ mat, day, night }` entries; `emissiveIntensity` is interpolated by time of day
- `ctx.updaters`: per-frame callbacks `(time, night)` for the fountain spray and the Ferris wheel
- `ctx.water`, `ctx.riverNormals`, `ctx.streetLights`, `ctx.parkRects`, `ctx.bridges`, `ctx.cityBoxes`
- `ctx.data`, `ctx.roads`, `ctx.measuredBuildings`, `ctx.collisionBuildings`, `ctx.life`, `ctx.cityDetailUpdate`, `ctx.explorer`

**Facade shader (`js/textures.js` → `facadeMaterial`).** Every building, landmarks and the instanced filler city alike, uses a `MeshStandardMaterial` patched with `onBeforeCompile`. It draws windows procedurally from world position and normal, so geometry needs no UVs.
- Seeds are quantized before hashing to avoid interpolated-seed noise. Distant windows converge to their area average using `fwidth`; nearby night windows light in office groups.
- The shared uniform `uNight` (0 = day, 1 = night) drives lit windows.
- The instanced filler city uses `instanced: true`, which reads a per-instance `aStyle` attribute (0 masonry, 1 curtain wall) and `gl_InstanceID` as the seed. This needs WebGL2.
- Merged measured buildings use `features: true` and per-vertex `aSeed` to keep lighting patterns distinct while sharing materials.

**City (`js/city.js`, `js/city-data.js`).** Inside the downtown coverage, measured footprint extrusions replace the procedural grid, except for individually curated landmarks. Outside it, the simpler 125 m grid fills the distant skyline in one InstancedMesh. Do not put synthetic blocks back inside the measured coverage.

`js/coverage.js` owns the shared coverage union, projection and map envelope. The Fulton Market rectangle overlaps downtown and reaches OnDean without filling the entire western strip. Import caches hash complete query URLs; source IDs deduplicate the overlap. `offices.js` batches exterior geometry, generates its own brick/plaque textures and culls decorative detail beyond 1200 m. Office models add no lights, particles or shadow casters.

**Street life (`js/city-world.js`, `js/city-life.js`, `js/movement.js`).** City centerlines supply road geometry, bridge ramps, directed traffic lanes and sidewalks. Riverwalk and park routes are authored approximations. There are 480 vehicles, 800 people and eight boats. CTA trains now belong to `transit-simulation.js`, not a generic closed Loop. Signals use protected crossing intervals and vehicles keep gaps. Pause city life also pauses trains, the fountain and Ferris wheel; it leaves water shading active. Reduced-motion users start paused and skip camera flights.

**CTA (`js/transit*.js`).** Load `assets/transit.json` before generating buildings/furniture so explicit replacement IDs and entrance exclusions apply. The offline importer is `tools/import-transit.mjs`; source bytes are pinned by `tools/transit-sources.lock.json`, and reviewed corrections live separately in `tools/transit-corrections.json`. Preserve the dated ignored cache. The map uses the existing geographic projection with equal horizontal/vertical scale. Red and Blue are map/entrance only within this boundary; Yellow has no downtown geometry. `ctx.transit` exposes data, sim, stats, selection, highlights and follow state. The UI is `transit-ui.js` and `assets/transit.css`; the build hashes and copies both. Keep the original 18-stop architecture tour intact. Run the four existing checks plus `node tools/check-transit.mjs`; compare `.cache/transit-baseline/docs/` with the working build in the foreground review page. See SOURCES.md for historical entrance and estimated infrastructure limitations.

**Mini Fellow (`js/mini-fellow.js`, `js/mini-fellow-world.js`).** The explorer button enters a point picker, then eye-level walking or free flight. Camera ownership suspends OrbitControls, tour/follow updates and the aerial height floor until Exit/Escape restores the saved view. Walk surfaces come from coverage, waterfront terrain and road/bridge paths; spatially indexed building footprints prevent tunneling and permit wall sliding. These are approximate exterior collisions, not interiors or full game physics. Pointer lock is optional, with drag-look and keyboard/touch alternatives. Keep the normal far plane so the sky dome remains visible. There is no automatic camera bob or change to city-life pause. Run `node tools/check-mini-fellow.mjs` after building, plus the five existing checks. The review page's Check Mini Fellow reports placement, camera ownership, phone layout and spawn validity near all modeled CTA stations.

**Lighting (`js/lighting.js`).** Time of day is one scalar, `t ∈ [0,1]`, interpolating sun direction, light colors/intensities, exposure, fog, night, sky, water and environment strength. `PRESETS` maps the UI chips to `t` values.
- The visible sky uses a lightweight gradient shader with a small analytic sun. Its horizon matches the fog color, avoiding a hard seam at the finite terrain edge.
- Environment reflections use a gradient dome plus one merged batch of simplified nearby building silhouettes, baked through PMREM at most every 0.5 s when time changes. There is no live cube camera. The silhouettes are approximate reflections, not an exact scene capture.
- The sun's shadow camera follows the orbit target, snapped to 40 m steps.

**Water.** Lake Michigan uses the three.js `Water` addon. Its fragment shader is patched to replace a constant grey reflection term with `waterColor`. The river is a separate MeshStandardMaterial strip with a scrolling normal map.

**Camera & tour (`js/tour.js`).**
- `Flyer` handles fly-to animations and the guided tour (the `TOUR` id list).
- `viewFor(L)` derives the camera position from a landmark's `view: { az, dist, el }`.
- It evaluates alternate angles and elevations against surrounding building bounds, checking multiple points on the facade. Flights ascend above intervening buildings, cross, then descend.
- `overviewPos(aspect)` pulls the camera back on portrait screens.
- Any pointerdown on the canvas cancels a flight or tour.

**UI.** The main DOM is in `index.html`; `setupUI()` in `main.js` wires it up. `explorer.js` adds district presets, pause, an orientation map and the source-credit dialog. The page is single-theme dark: CSS tokens on `:root`, fonts Big Shoulders Display, Barlow and IBM Plex Mono. At widths of 720 px and below, the landmark panel becomes a toggled sheet.


## Waterfront maintenance

`tools/build-waterfront.mjs` builds `assets/waterfront.json` offline. Its local metre coordinates use the same origin as `coverage.js`. The City water polygons supply the land foundation; landscape outlines and architectural subdivisions are documented visual estimates. Regenerate this asset after editing the generator, then rebuild the site.

The active additions are `waterfront-data.js` (pure predicates, loader, append-only route registry), `waterfront.js` (batched landscape/harbor geometry), and `navypier.js` (replacement architecture). `terrain.js` consumes the generated land polygons. Do not restore the old rectangle park builder or modify the unused `streets.js` expecting a waterfront change. Keep `city-world.js` as the active street builder.

All new routes use `registerRoute(ctx,id,points,mode)`, where mode is walk, cycle or shared. Never assign an entire park route array from an individual builder. The city population is 720 walkers plus 80 cyclists; vehicles/trains/moving boats keep their earlier budgets. `ctx.waterLevel()` supplies the actual rendered surface height for moored boats/docks; the harbor uses the reflective lake, while the green river material ends at its mouth. New landscape and pier meshes do not cast shadows.

Run `node tools/check-waterfront.mjs` in addition to the existing two checks. The review page includes close/overhead views and fixed comparison cameras. Archive the current docs before changes under `.cache/waterfront-baseline/docs/`; compare both builds at 1200 by 740, golden hour and tier 0, with a foreground tab and warmed shaders. Recheck both offices and the unchanged tour when touching geographic masks or camera bounds.
