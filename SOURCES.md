# Chicago model: sources and reproducibility

The detailed downtown core uses public geographic data. The outer skyline, materials, street furniture and animated activity are illustrative. This is an architectural visualization, not a survey or live transit map.

## Geographic sources

- **Cook County GIS, 2022 building footprints and heights:** [feature layer](https://gis.cookcountyil.gov/traditional/rest/services/buildingFootprint_2022/MapServer/0), [metadata](https://www.arcgis.com/sharing/rest/content/items/7c4f47a3b32944e58c5f18652880fc05/info/metadata/metadata.xml?format=default&output=html). Based on 2022 lidar and imagery. The `Height` field is the highest building point above ground in feet; it can include antennas and equipment. The importer converts feet to metres. Named landmark models use curated architectural heights instead.
- **City of Chicago street centerlines:** [dataset pr57-gg9e](https://data.cityofchicago.org/d/pr57-gg9e), 2016 snapshot. The importer retains coordinates, class, direction, elevation level and node IDs. The rendered traffic network excludes lower streets, ramps and expressways. It is intentionally simplified.
- **City of Chicago water polygons:** [dataset knfe-65pw](https://data.cityofchicago.org/d/knfe-65pw), 2014 snapshot. Supplies the downtown river and lake edge.

Required City attribution: This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago.

`node tools/import-city.mjs` regenerates `assets/downtown.json`. It caches downloaded source responses under ignored `.cache/`. The shipped asset contains 3,091 footprint features and 2,585 street segments before runtime filtering and landmark replacements; it is about 1.13 MB uncompressed. Browser clients fetch this bundled asset once and do not contact GIS APIs.

The geographic envelope is longitude −87.650 to −87.598, latitude 41.8654 to 41.9035. Local projection uses origin −87.62786, 41.88202, with 82,950 metres per degree longitude and 110,574 metres per degree latitude. Footprints are simplified to 0.7 m tolerance. Very small features are discarded; missing heights use an explicitly flagged 12 m estimate. Materials are assigned stylistically rather than surveyed. One Prudential Plaza's main mass is corrected to 183.2 m so its antenna is not rendered as an oversized building.

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

## Validate and publish

```sh
node tools/build-site.mjs https://srtjairo.github.io/chicago-3d/
node tools/check.mjs
node tools/check-city.mjs
node tools/serve.mjs 8080
```

Open `http://localhost:8080/tools/review.html` for landmark/district views, phone layout, scene checks, motion audit and foreground frame-time measurement. Check day and night, map/about/pause controls and console errors. The local capture button updates `preview.png`; rebuild afterwards. Commit source and generated `docs/` together, push `main`, then verify the public `revision.json` matches the local build. GitHub Pages serves `main` → `/docs`.

Performance results are device-, view- and quality-dependent. Desktop browser QA and narrow-viewport layout checks do not establish real MacBook or physical-phone frame rates.
