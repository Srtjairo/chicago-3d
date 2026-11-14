// The lakefront outside downtown's hand-built waterfront: features the City's park outlines don't
// show. The Park District's "BURNHAM (DANIEL)" outline, for example, is one 658-acre polygon that
// also covers Soldier Field's parking lots and plazas, so on its own it draws everything as lawn.
//
// Where an OpenStreetMap survey is cached (tools/fetch-osm-area.mjs; Museum Campus, Soldier Field,
// Burnham Harbor and Northerly Island so far), tools/build-tiles.mjs draws its mapped outlines
// instead: lots, lawns, gardens, prairie, beaches, plazas, walks, the Lakefront Trail, docks and
// every mapped tree. This list is for places no survey covers yet: shapes traced against the
// City's street centrelines, footprints, park outlines and shoreline, in local metres (x east,
// z south of State & Madison). Polygons only need to be roughly right at their street edges:
// streets, sidewalks and buildings draw on top, and polygons are clipped to dry land.
//
// kinds: parking | paved | plaza | lawn (mown, no random trees) | prairie | sand | vacant | water
//        trail (Lakefront Trail, line) | walk (park walk, line) | trees (a row, line, `step` m apart)

export const LAKEFRONT = [];
