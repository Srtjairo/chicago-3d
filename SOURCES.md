# Chicago model: sources and reproducibility

The detailed downtown core uses public geographic data. The outer skyline, materials, street furniture and animated activity are illustrative. This is an architectural visualization, not a survey or live transit map.

## Geographic sources

- **Cook County GIS, 2022 building footprints and heights:** [feature layer](https://gis.cookcountyil.gov/traditional/rest/services/buildingFootprint_2022/MapServer/0), [metadata](https://www.arcgis.com/sharing/rest/content/items/7c4f47a3b32944e58c5f18652880fc05/info/metadata/metadata.xml?format=default&output=html). Based on 2022 lidar and imagery. The `Height` field is the highest building point above ground in feet; it can include antennas and equipment. The importer converts feet to metres. Named landmark models use curated architectural heights instead.
- **City of Chicago street centerlines:** [dataset pr57-gg9e](https://data.cityofchicago.org/d/pr57-gg9e), 2016 snapshot. The importer retains coordinates, class, direction, elevation level and node IDs. The rendered traffic network excludes lower streets, ramps and expressways. It is intentionally simplified.
- **City of Chicago water polygons:** [dataset knfe-65pw](https://data.cityofchicago.org/d/knfe-65pw), 2014 snapshot. Supplies the downtown river and lake edge.

Required City attribution: This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago.

`node tools/import-city.mjs` regenerates `assets/downtown.json`. It caches downloaded source responses under ignored `.cache/`, keyed by the complete query URL including bounds and pagination. Overlapping queries deduplicate building and street source IDs. The shipped asset contains 3,507 footprint features and 2,742 street segments before runtime filtering and landmark replacements; it is about 1.24 MB uncompressed. Browser clients fetch this bundled asset once and do not contact GIS APIs.

The original source envelope is longitude −87.650 to −87.598, latitude 41.8654 to 41.9035. A second query covers the Fulton Market extension with 80 m padding. `js/coverage.js` defines the measured area shared by importing, buildings, roads, procedural exclusion and the map: downtown x −1800 to 2400 / z −2300 to 1800, plus Fulton Market x −2450 to −1750 / z −1250 to −400. Local projection uses origin −87.62786, 41.88202, with 82,950 metres per degree longitude and 110,574 metres per degree latitude. Footprints are simplified to 0.7 m tolerance. Very small features are discarded; missing heights use an explicitly flagged 12 m estimate. Materials are assigned stylistically rather than surveyed. One Prudential Plaza's main mass is corrected to 183.2 m so its antenna is not rendered as an oversized building.

## Architectural references

The six additional landmarks were modeled from published descriptions and dimensions:

| Landmark | Architectural height | References |
| --- | --- | --- |
| Aqua | 261.8 m / 859 ft | [Chicago Architecture Center](https://www.architecture.org/online-resources/buildings-of-chicago/aqua), [CTBUH](https://www.skyscrapercenter.com/building/aqua/886) |
| Tribune Tower | 141.7 m / 465 ft | [Chicago Architecture Center](https://www.architecture.org/online-resources/buildings-of-chicago/tribune-tower), [CTBUH historical listing](https://www.skyscrapercenter.com/buildings?function=all&location=world&material=all&status=completed&year=1930) |
| Carbide & Carbon | 153.3 m / 503 ft | [Chicago Architecture Center](https://www.architecture.org/online-resources/buildings-of-chicago/carbide-and-carbon-building), [CTBUH](https://www.skyscrapercenter.com/building/carbide-carbon-building/3770) |
| THE MART | 103.6 m / 340 ft | [THE MART](https://www.themart.com/about/), [CTBUH](https://www.skyscrapercenter.com/building/wd/9019) |
| Chicago Board of Trade | 184.4 m / 605 ft | [Chicago Architecture Center](https://www.architecture.org/online-resources/buildings-of-chicago/chicago-board-of-trade-building), [CTBUH](https://www.skyscrapercenter.com/complex/967) |
| 150 North Riverside | 220.7 m / 724 ft | [Chicago Architecture Center](https://www.architecture.org/online-resources/buildings-of-chicago/150-north-riverside), [Goettsch Partners](https://www.gpchicago.com/news/150-north-riverside-office-tower-debuts-chicago/) |

These are simplified, code-generated models. Detailed cornices, balconies, crowns, riverwalk features and park elements are interpretations rather than as-built replicas. The Loop railway alignment and station positions are authored approximations; no CTA feed or service schedule is used. No third-party photographs or downloaded facade textures are included.

## Selectable offices

- **Relativity / Central Standard Building, 231 S LaSalle:** replaces only County footprint `891214-0`, centered at x −302.4 / z 391. The [owner's exterior photographs and building history](https://beaconcapital.com/property/231-s-lasalle) inform the limestone massing, window bays, west entrance columns and pediment, cornices and roofline. [CTBUH](https://www.skyscrapercenter.com/pdf/building/29217) supplies the 92.1 m architectural height; the owner gives the 1924 completion. [Relativity's published office details](https://careers.relativity.com/campaign/engineering-the-future-generative-ai-hiring-event/) identify the 20th floor. No interior or particular window section is claimed to represent that office. The close camera is aimed at the LaSalle entrance within the narrow street canyon.
- **OnDean Family Office, 410 N Carpenter:** the office association was supplied by the project owner. County footprint `860470-0` at x −2145.5 / z −794.05 matches the low red-brick warehouse west of Carpenter and north of Kinzie in the [broker's frontage photographs and aerial](https://www.awproperties.com/properties/fulton-market-redevelopment-site-chicago-il/) and [property brochure](https://images1.showcase.com/d2/2n_melZwkHWrCUHVAvjevkSDlIAiXhJLLOE4ARYTp7w/document.pdf). This parcel was matched to the pictured street corner and shared west wall, not selected from an interpolated street-address point. The county's 14.3 m highest-point field does not match the photographed low roof beside its taller neighbor. The model uses an **estimated 9.1 m roof**, informed by the [broker's 24 ft clear-height listing](https://www.loopnet.com/Listing/1044-w-kinzie-st-chicago-il/29087396/) and exterior proportions, with roof equipment above. This is a visual estimate, not a surveyed architectural height; the public card omits height and construction year. The glass bands, loading bays, entrance and existing stone address plaque follow the photographs. No company logo or invented exterior sign is added.

Both offices are selectable in the list and scene labels, and marked on the map. Their models replace exactly one source footprint each, have explicit collision bounds and distance-based detail, and add no dynamic lights or shadow casters. The opening view, 18-stop guided tour and city-life budgets are unchanged.

## Validate and publish

```sh
node tools/build-site.mjs https://srtjairo.github.io/chicago-3d/
node tools/check.mjs
node tools/check-city.mjs
node tools/serve.mjs 8080
```

Open `http://localhost:8080/tools/review.html` for landmark/district views, phone layout, scene checks, motion audit and foreground frame-time measurement. Check day and night, map/about/pause controls and console errors. The local capture button updates `preview.png`; rebuild afterwards. Commit source and generated `docs/` together, push `main`, then verify the public `revision.json` matches the local build. GitHub Pages serves `main` → `/docs`.

Performance results are device-, view- and quality-dependent. Desktop browser QA and narrow-viewport layout checks do not establish real MacBook or physical-phone frame rates.

Office-addition comparison (2026-10-29): Chrome on an NVIDIA RTX 4070, 1200 × 740 viewport, opening skyline, golden hour, quality tier 0, visible and focused tab. Two warmed 8-second runs per build measured **6.9 ms median / 7.1 ms p95** for both previous revision `3baef5c6c5a12709` and office revision `35b31ee84a7f8c36`, within the 10% regression target. These samples are display-rate limited. Peak draw calls increased from 654 to 684 (4.6%). The local review page's Build selector can compare an archived previous `docs/` under `.cache/baseline/` with the working build.
