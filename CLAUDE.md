# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Leaflet-based interactive map application (溫SINT地圖) that visualizes Chinese military and defense-related facilities from GeoJSON data. The application supports advanced geospatial search, custom shape overlays (no-fly zones), equipment information lookup via Wikipedia, and local notes stored in IndexedDB.

## Development Commands

### Local Development Server
```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

Alternative (if Node.js available):
```bash
npx serve
```

### Data Validation
```bash
# List all layer names in GeoJSON
python3 classify_layer.py

# Validate JSON structure (requires jq)
jq . joseph_w.geojson
```

## Architecture

### Data Flow
1. **Data Source**: GeoJSON files (`joseph_w.geojson` is primary, with dated snapshots like `joseph_w-20250806.geojson`)
2. **Loading**: `main.js` fetches GeoJSON via `fetchGeoJSON()` (configurable via `DATA_BASE_URL`)
3. **Rendering**: Features filtered by radius/layer, rendered as Leaflet markers
4. **Equipment Enrichment**: `equipment_parser.js` extracts equipment names from feature properties, queries Wikipedia API for summaries
5. **Shape Overlays**: `shape_utils.js` parses URL parameters to render circles, polygons, lines, sectors, or multi-shape overlays

### Initialization Flow
1. Map and base layer initialized (`googleSea` default)
2. **Parallel load**: `Notes.init(map)` and `fetchGeoJSON(url)` run via `Promise.all()`
3. GeoJSON data populates `allFeatures` and `layerIndex`
4. Shape mode or standard radius mode renders markers
5. `setupMapTools()` deferred via `requestAnimationFrame` (after map data displays)
6. Init timing logged to console

### Tile Layers
- **googleSea** (海域): `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=zh-TW` — 衛星混合圖（satellite hybrid）
- **googleAir** (空域): `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=zh-TW` — 標準道路圖（standard road map）
- HTML segmented 按鈕（控制面板「底圖」群組）：「海域」與「空域」（`.layer-toggle-btn[data-layer="sea"|"air"]`）
- `switchBaseLayer('sea')` / `switchBaseLayer('air')` 切換底圖

### Module Responsibilities

**`static/js/search_utils.js`** (Search & Language Utilities)
- Traditional to Simplified Chinese character conversion (200+ common characters)
- Fuzzy search algorithm with scoring
- Searches across `名稱`, `說明`, and `layer` fields
- Highlight matching text in results
- Optimized for GeoJSON feature collections

**`static/js/main.js`** (Core Logic)
- URL parameter parsing (`parseUrlCoordinates`, `parseShapeParams`)
- Map initialization and event handlers
- Two rendering modes:
  - `renderMap(coords, radius, layer)`: Standard radius-based search
  - `renderShapeMode(shapeSpec, layer)`: Custom shape overlay mode
- Popup generation with links to Google Maps/Wikipedia
- Async equipment data loading and caching
- Location search with live results (`performSearch`, `selectSearchResult`)
- Keyboard navigation support (Arrow keys, Enter, Escape)

**`static/js/equipment_parser.js`** (Equipment Intelligence)
- Regex-based extraction of equipment names from Chinese text (pattern: `裝備：...`)
- Wikipedia API integration with 30-minute cache
- Mobile-optimized: 3 items max on mobile, 5 on desktop; 8s/5s timeout
- Fallback database for common equipment types

**`static/js/url_params.js`** (URL Parameter Access — `window.UrlParams`)
- The single way to read and write URL parameters. **Never call `new URLSearchParams(location.search)` directly again** — it silently ignores anything in the hash
- `read()` returns the merged params (query as base, hash overriding per key); `query()` / `hash()` return one side; `sourceOf(key)` says which side a key came from
- `commit(params, { mode })` / `buildUrl(params)` write back. **A key that arrived in the hash is written back to the hash** — writing it to the query string would be shadowed by the hash and silently do nothing, which is exactly what the colour picker's write-back would hit
- `commit()` edits the hash at the **segment level**, keeping the original text of every segment it did not change. It never rebuilds the hash with `toString()`: the `#ais=` payload runs to tens of thousands of characters and re-encoding it would break existing links
- A query value **shadowed** by the hash is left in place rather than deleted. It can never win a read, so keeping it is inert, while deleting it would throw away part of the author's original link every time the user nudged something unrelated (change a colour, lose `?radius=50`). Only removing a key outright clears both sides
- A hash with no `=` is a plain anchor (`#top`, `#ais`), not parameters, and is passed through untouched
- Must be the **first** app script in `index.html`: `shape_color.js` calls `read()` at module top level
- `rawHashValue(key)` returns a hash value **still encoded**, and finds it at any position. `#ais=` needs this: its payload carries its own per-field encoding that the caller decodes itself, so decoding here would double-decode. The four `ais=` call sites used to require it to be the hash's first segment, which only held while the hash carried nothing else
- `hashHas(key)` also covers the bare-anchor spelling (`#ais` with no `=`)
- `commit(params, { newKeysTo: 'hash' })` puts **brand-new** keys in the hash instead of the query string. The colour picker passes it when `sourceOf('shape') === 'hash'`, so a hash-only shape link does not leak half of itself into the query string. Without it, new keys default to the query string, which keeps links that never used the hash byte-identical
- Parse failures return empty params rather than throwing — a malformed hash from an external system must not break the map

**`static/js/shape_utils.js`** (Geometry Utilities)
- Pure functions for coordinate parsing and geodesic calculations (no Leaflet dependency)
- Supports `point`, `circle`, `line`, `polygon`, `bbox`, `sector`, `multi` shapes
- Unit conversion: nautical miles (`nm`), kilometers (`km`), meters (`m`)
- Distance calculations: point-to-line, point-in-polygon, bearing/sector checks
- Colour helpers: `normalizeShapeColor()` (validates hex/named input, returns `null` when unparseable), `shadeShapeColor()` (derives the darker stroke), `buildShapePathStyle()` (stroke + fill + opacity for a Leaflet path)
- KML building: `buildShapeKml()` / `buildShapesKml()` emit one `<Style>` per distinct colour
- `parseShapeParams()` assigns each parsed shape a stable `uid`, plus `colorParam`/`colorIndex` so the picker knows which URL param to write back

**`static/js/shape_color.js`** (Shape Colour Customisation)
- Owns `window.ShapeColor`; loaded after `shape_utils.js` in `index.html`
- Renders the collapsible colour picker inside shape popups (9 presets + native colour input)
- **URL is the single source of truth**: picks are written back via `history.replaceState`, so "複製網址", KML export, and any re-render (layer filter, search) all inherit the current colours without extra state
- `beginRender()` clears the layer registry on each `renderShapeMode()`; `register()` records a per-shape `apply(color)` callback and remembers the link's original colour for "重設顏色"
- Entirely optional — if this script fails to load, `geo_shapes.js` skips the picker and everything else works unchanged

**`static/js/map_context_menu.js`** (Map Context Menu)
- Right-click on desktop, 500ms long-press on touch → menu showing the point's coordinates plus 「搜尋此座標」
- The long press is hand-rolled on `touchstart`/`touchmove`: Android Chrome emits a native `contextmenu` on long press, iOS Safari usually does not on a non-link element
- The action fills `latInput`/`lngInput` and calls `searchLocation()`, reusing the panel's current radius — it never changes the radius on the user's behalf

**`static/js/osint_data.js`** (Public OSINT Views)
- `mnd`: the daily MND report snapshot in `data/mnd_activity.json`, refreshed by `.github/workflows/update_osint.yml` (3×/day)
- `sheet`: PLATracker's public ADIZ database, read as CSV through Google's `gviz/tq?tqx=out:csv` endpoint (which sends CORS headers) and laid out by the app — metrics, an inline-SVG bar chart and a table. It is deliberately **not** an iframe of Google's `htmlview`: that embed carries its own horizontal and vertical scrollbars inside the panel
- `marine`: Open-Meteo marine model samples rendered as map markers

**`static/js/mnd_overlay.js`** (Official Chart Overlay)
- Places MND's daily 臺海周邊海、空域活動示意圖 on the map as a georeferenced `L.imageOverlay`
- It is not a guess: the chart is drawn in Web Mercator with a 1° graticule, so it lines up with Leaflet exactly. Measured on the official 720×1040 originals (identical across every day sampled): 117°E at x=124, 123°E at x=612.5 (81.42 px/°), 29°N at y=181, 21°N at y=901, with every other parallel within 0.4 px of the Mercator prediction. Extrapolating the full image gives `IMAGE_BOUNDS` = SW 19.39890, 115.47697 / NE 30.92455, 124.32037; in-browser checks put known graticule crossings within 0.6 px
- **Guard**: every load verifies the source image is still 720×1040 and removes the overlay otherwise — if MND changes the template the pixel baseline no longer holds, and a silently misplaced chart is worse than no chart
- `.mnd-overlay-image` in `osint_data.css` clips the title, table margins and legend away with `clip-path`, using the same measurements. **Change one and you must change the other.**

**`static/js/mnd_areas.js`** (Reported Activity Areas — off by default, toggled from 疊加範圍)
- Draws the red activity outlines from MND's daily chart as real polygons, read from the `areas` field of `data/mnd_activity.json`; the dataset is only fetched when the layer is first switched on
- The vectorisation happens in `scripts/mnd_chart_areas.py` during the data refresh, **not** in the browser: mnd.gov.tw sends no CORS header, so a canvas read of the chart is blocked
- Shows the newest report that actually has areas (some days have none, some older reports have no chart at all) and always labels that date
- Polygons carry `className: 'mnd-area-path'`, which must stay in the `:not()` list of the stroke rule in `main.css` — see CSS Gotchas

**`static/js/submarine_cable.js`** (Submarine Cables)
- 728 segments / 707 distinct cables from `geojson/submarinecablemap.json`, off by default, toggled from 公共設施
- Features are grouped by their stable `id` slug, because a cable can be split across several segments (`echo` has 3) and they must show and hide together
- `cable=` opens the layer from the URL (see URL Parameter System). Matching is deliberately loose — exact `id`, then normalised exact `id`/`name`, then normalised substring — so `cable=TPKM2` finds `taiwan-penghu-kinmen-matsu-no-2-tpkm2` without the user memorising the slug
- **Never index cables by position (`cable=1~N`).** The ordinal is an array offset in the dataset; refreshing it shifts every cable after an addition or removal, so a shared link silently points at a different cable
- Paths carry `className: 'submarine-cable-path'`, already in the `:not()` list of the stroke rule in `main.css` — see CSS Gotchas

**`static/js/notes.js`** (Notes System)
- IndexedDB-only storage (no cloud backup)
- CRUD operations, map markers, export/import
- Supports Point, LineString, Polygon, Circle, Sector, Rectangle geometries

**`index.html`**
- Loads Leaflet 1.9.4, Leaflet.draw, PolylineMeasure plugins
- Control panel for manual coordinate input, layer filtering, and base layer toggle (海域/空域)
- Mobile-responsive with tap-to-close panel behavior

**`download_googlemap.js`** (Bookmarklet)
- Browser script to extract Google Maps data and convert to GeoJSON
- Run on `mymaps.google.com` to export custom map layers
- Handles bidirectional text markers and multi-layer maps

**`scripts/mnd_chart_areas.py`**
- Turns the red outlines on the daily chart into lon/lat rings, using the same Mercator pixel basis as `mnd_overlay.js`
- Run from `scripts/update_mnd_activity.py`, which stores the result per report as `areas` and only fetches charts it has not vectorised yet (capped per run)
- Needs Pillow + numpy (installed by the workflow). Without them `extract_areas()` returns `None` and the numeric pipeline still publishes
- Refuses any chart that is not 720×1040 — the pixel basis would not hold, and a plausible wrong polygon is worse than none

**`classify_layer.py`**
- Python utility to list unique layer names from GeoJSON
- Edit `filename` variable inside script to target different files

### URL Parameter System

The application uses URL parameters for deep linking and state persistence.

**Every parameter below works identically after `?` and after `#`.** `#shape=circle&lat=25&lng=120&radius=50`
is equivalent to the same string after `?`. When both carry parameters, the query string is the base and
the hash overrides it **per key** (all of a key's query values are replaced by all of its hash values, so
repeated params like `circle=` keep their `getAll()` semantics). Reasons to prefer the hash:
- The browser never sends it, so coordinates stay out of access logs and `Referer` headers
- It holds far more than a query string, which Cloudflare caps at roughly 8 KB of request line —
  a polygon with many vertices or a long `text=` label only fits in the hash
- Editing it re-renders the shapes in place without reloading the page (`hashchange`)

All of this goes through `static/js/url_params.js`; see its module entry below before touching any
`location.search` / `location.hash` code.

**Basic Search**:
- `lat`/`lng` or `coords=lat,lng`: Center coordinates
- `radius=N`: Search radius in km (default: 100km, or 50km if coords provided)
- `layer=Name`: Pre-filter to specific layer

**Shape Mode** (triggers via `shape=` parameter):
- `shape=circle|line|polygon|bbox|sector|multi`: Shape type
- `unit=nm|km|m`: Distance unit (affects radius)
- `text=Label`: Optional popup label
- Shape coordinates use `lng,lat` format separated by semicolons
- Examples:
  - Circle: `?shape=circle&lat=25&lng=120&radius=50&unit=nm`
  - Line: `?shape=line&line=120,25;121,26&radius=10`
  - Multi: `?shape=multi&circle=120,25,30&sector=121,26,50,0,90&unit=km`

**Shape Colours** (all optional — omitting them renders exactly as before):
- `color=`: applies to every shape in the URL
- `circle_color=`, `line_color=`, `poly_color=`, `sector_color=`: per-shape, using the same indexed syntax as the existing `*_text` params (repeat the param, pass a JSON array, or use `poly_color[1]=`)
- Precedence: per-shape colour > `color` > default `#ef4444`
- Accepts `#rrggbb`, `#rgb`, bare hex, or names (`red`, `orange`, `teal`, …). Invalid values fall back to the default rather than throwing
- Stroke is auto-darkened from the fill so every colour keeps the "deep border, light fill" look; very dark colours are lightened instead so the outline stays visible
- Users can change colours live from the popup picker; the change is written back into the URL

**Submarine Cables**:
- `cable=all` or `cable=1`: show every cable (equivalent to ticking the 公共設施 checkbox)
- `cable=<id-or-name>`: show only those cables, fit the map to them, and open the popup when exactly one matched
- Repeat the param or comma-separate for several: `cable=tpkm2,tpkm3`
- Unmatched tokens are warned about in the console; if nothing matched at all the layer falls back to showing every cable rather than disappearing
- Removing the param again hides the layer only if it was the URL that opened it, so a manual tick is never undone by an unrelated hash edit

**Shape Mode Behavior**:
- Defaults to hiding unit markers (`unitsVisible = false`)
- Filters features within specified distance from shape boundaries
- Updates control panel to reflect current state
- Multi-shape URLs render each sub-shape with its own popup; there is no aggregate overview marker

### State Management

Global state variables in `main.js`:
- `map`: Leaflet map instance
- `allFeatures`: Full GeoJSON FeatureCollection (loaded once)
- `currentMarkers`: LayerGroup for visible markers
- `centerMarker`: Current search center marker
- `nfzLayerGroup`: No-fly zone shape overlays
- `unitsVisible`: Boolean for marker visibility toggle
- `drawnItems`: FeatureGroup for user-drawn shapes (via Leaflet.draw)

### Location Search System

The search functionality enables users to find locations by name with Traditional Chinese input:

**Features**:
- Real-time search with 300ms debounce
- Traditional → Simplified Chinese conversion (200+ common characters)
- Fuzzy matching across `名稱`, `說明`, and `layer` fields
- Result scoring and sorting by relevance
- Keyboard navigation (↑/↓ to select, Enter to confirm, Esc to close)
- Auto-jump to selected location with 10km default radius
- Mobile-optimized (20 results max on mobile, 50 on desktop)

**Search Flow**:
1. User types in search input
2. After 300ms idle, `performSearch()` executes
3. `searchUtils.searchFeatures()` converts Traditional → Simplified
4. Fuzzy match against all features
5. Score results (exact match: 100, prefix: 80, contains: 50)
6. Display top N results in dropdown
7. User selects → coordinates fill inputs → map renders

**Key Functions**:
- `performSearch()`: Trigger search with current input
- `displaySearchResults()`: Render dropdown with highlighted matches
- `selectSearchResult(index)`: Navigate to selected location
- `setupSearchInput()`: Initialize keyboard/click handlers

### Equipment Data Processing

Equipment parsing is **asynchronous and lazy**:
1. Markers bind popup open event listener
2. On first popup open, equipment text is extracted and parsed
3. Wikipedia queries run in parallel with 500ms/1s loading delay
4. Results are cached (30min) and injected into popup HTML
5. Uses `layer._equipmentParsingStarted` flag to prevent duplicate processing

### Performance Optimizations
- `Notes.init()` and GeoJSON fetch run in parallel via `Promise.all()`
- `setupMapTools()` deferred to after map data renders (via `requestAnimationFrame`)
- GeoJSON cache strategy: `staleWhileRevalidate` in Service Worker (was `networkFirst`)
- `fetchGeoJSON()` helper extracted from init for clearer separation
- Init timing logged to console

### Service Worker
- `APP_VERSION` in `sw.js` is the single source of truth; keep `manifest.json` `version`, the `version` fallback in `pwa.js`, and the `CHANGELOG` entry in `map_state.js` in sync when bumping
- CORE_ASSETS: `url_params.js`, `notes.js`, `map_context_menu.js`, `mnd_overlay.js`, `mnd_areas.js`, `equipment_parser.js`, `search_utils.js`, `shape_utils.js`, `shape_color.js`, `osm_facilities.js`, `unified_dropdown.js`, `pwa.js`, etc. — **add any new `static/js/*.js` here and to `index.html`**
- GeoJSON/JSON: `staleWhileRevalidate`（快取優先，背景更新）

## Deployment

Served by **Cloudflare Pages**, deployed automatically on every push to `main`
(no build step: build command empty, output directory `/`).

- **`_headers`** declares the cache and CORS policy. Pages purges the edge on every deploy,
  so `s-maxage` can be long while browser `max-age` stays short.
- **`_headers` alone is not enough**, and this is the non-obvious part. Cloudflare only
  edge-caches a default list of extensions, which excludes `.geojson`/`.json`, and the
  zone's Browser Cache TTL (4h here) overrides whatever `max-age` the origin sends. Both
  zones therefore carry a matching set of Cache Rules, scoped to the `rnap` host so they
  cannot touch anything else on the zone:
  1. `respect_origin` for both edge and browser TTL — without this `_headers` is ignored
  2. `cache: true` for `.geojson`/`.json` — without this datasets stay `DYNAMIC`
  3. `cache: false` for `/sw.js`
  If a cache change in `_headers` appears to do nothing, check these rules first.
- `Access-Control-Allow-Origin: *` on `/*` is deliberate. Both GitHub Pages and Cloudflare
  Pages happen to send it by default today, but other projects consume these datasets
  cross-origin, so the rule pins the behaviour instead of trusting a platform default.
- `/sw.js` must stay `no-store`. Any intermediary cache on it delays every PWA update.
- **Precache `/`, never `/index.html`.** Pages 308s `/index.html` to `/`, and
  `cache.addAll()` rejects the entire batch if any response was redirected — so a single
  `/index.html` entry in `CORE_ASSETS` silently breaks offline support and PWA install for
  the whole app. The navigation handler's `caches.match()` key must match it. This differs
  from GitHub Pages, which served `/index.html` with a plain 200.
- **`404.html` must exist.** Without it Pages serves `index.html` with a `200` for every
  unknown path, so a renamed or deleted dataset returns HTML instead of a 404 —
  `refreshData()` in `sw.js` only checks `response.ok`, and would cache that HTML as data.
  It is deliberately not in `CORE_ASSETS`: the service worker answers every navigation
  from the cached shell, so the 404 page only ever renders for visitors without an active
  worker. What it really protects is non-navigation fetches of missing data files.

### Domains

- **`rnap.watchember.cc`** — canonical. `og:url` and `<link rel="canonical">` point here.
- **`rnap.riotoolkit.cc`** — retiring. Still serves identical content so existing
  dependencies keep working; a guard at the top of `index.html` hops human visitors to the
  canonical host, and `sw.js` (`IS_LEGACY_HOST`) skips precaching, stops intercepting,
  clears its caches and unregisters itself there.
- Do **not** put a 301 on the legacy host yet: a redirected `/sw.js` makes Service Worker
  updates fail permanently, freezing existing installs where nothing can reach them.
  The legacy host only becomes a redirect once its traffic has drained.
- Both hosts point at the same Pages project. There is no longer a GitHub Pages fallback
  to roll back to — that deployment is disabled and the `CNAME` file is gone.
- **Order matters when attaching a custom domain to Pages: point the DNS record at
  `apeintel-atlas.pages.dev` FIRST, then add the custom domain.** Pages validates over
  HTTP, so a hostname that still resolves somewhere else fails validation, and on timeout
  Pages removes the custom domain *and deletes the DNS record it considers its own* —
  leaving the hostname at `NXDOMAIN`. That happened to `rnap.riotoolkit.cc` during this
  migration and took the legacy host offline. In the correct order validation completes in
  well under a minute. Note that browsers and resolvers cache the `NXDOMAIN` for the SOA
  minimum TTL (1800s here), so recovery looks broken long after it is actually fixed —
  verify with `dig @<authoritative-ns>` or `curl --resolve`, never the local resolver.

## Coding Conventions

### JavaScript
- ES6+ browser-only (no Node.js/build tools)
- 2-space indentation
- Use `const`/`let`, no `var`
- Keep functions focused and side-effect scoped
- Public URLs centralized in constants (e.g., `DATA_BASE_URL`)

### CSS
- Class-based selectors (avoid IDs for styling)
- 2-4 space indentation
- Organize related rules together

### File Naming
- JavaScript utilities: `lower_snake_case.js`
- Data files: `.geojson` extension with optional date suffix

### Commits
- Format: `scope: imperative description`
- Examples: `map: improve URL parsing`, `data: refresh joseph_w.geojson`, `ui: fix mobile panel behavior`

## Data Sources

All GeoJSON files contain Point features with properties:
- `layer`: Category name (e.g., "解放軍空軍、海軍航空兵基地及設施")
- Custom fields: May include `裝備：` entries for equipment parsing
- `name`, `description`: Display text for popups

Primary data source: `joseph_w.geojson` (updated manually)
Snapshots: `joseph_w-YYYYMMDD.geojson` (version history)
External data: `submarinecablemap-cdn-json-20250618.json` (submarine cables)

## CSS Gotchas

**`stroke` is force-set on interactive SVG paths.** `static/css/main.css` carries a Leaflet.draw red-theme rule:

```css
.leaflet-overlay-pane svg path.leaflet-interactive:not(.adiz-path):not(.theater-path):not(.submarine-cable-path):not(.nfz-shape-path) {
  stroke: #ef4444;
}
```

CSS `stroke` **overrides the `stroke` presentation attribute Leaflet writes on the SVG**, so `setStyle({ color })` silently has no visible effect on any path not excluded here. Symptom: fill changes colour but the border stays red. Any layer needing a custom stroke must pass a `className` and be added to the `:not()` list (`adiz` / `theater` / `submarine-cable` / `nfz-shape` already are).

**Panel stacking order is `.panel-backdrop` (2550) < `.control-panel` (2600) < `.toggle-panel-mobile` (2610).** The mobile `.control-panel` rule carries its own `z-index`, so raising the desktop one is not enough. When the panel sits *below* the backdrop the symptom is not an invisible panel — it renders blurred and dimmed, and every tap lands on the backdrop, whose `onclick` closes the panel. It reads as "the panel is frozen".

**The `.dropdown-menu` z-index must stay above `.control-panel`.** Opening either 資料圖層 dropdown
reparents the menu to `<body>` on desktop — the panel's `backdrop-filter` makes it the containing
block for `position: fixed`, so the menu cannot be positioned from inside it. Once out of the panel
it also leaves the panel's stacking context and has to outrank it on its own (`2650` vs the panel's
`2600`, under `.map-context-menu`'s `2700`). At the old `2000` the menu rendered *behind* the panel,
and the symptom was not a misplaced menu but "clicking the dropdown does nothing".
The same reparenting is why the outside-click handler must accept `.dropdown-menu` as well as
`.unified-dropdown`: in `<body>` the menu has no `.unified-dropdown` ancestor, so every click on a
checkbox inside it counts as a click outside and closes the menu, making multi-select impossible.

**Do not add `scrollbar-width` / `scrollbar-color` to elements styled with `::-webkit-scrollbar`.** Chrome disables the `::-webkit-scrollbar` pseudo-elements entirely once a standard scrollbar property is present, reverting the element to the native scrollbar. Pick one system per element; the popups use the `::-webkit-scrollbar` route.

**Mobile inputs must render at ≥16px.** iOS zooms the page when a focused input is below 16px. `pwa.css` sets `input { font-size: max(16px, 1rem) }` on mobile, but any class selector (e.g. `.search-island-input`) outranks it, so class-styled inputs need their own mobile 16px rule.

**Gooey (`#liquid-goo`) goes on SVG content only.** Use the SVG `filter="url(#liquid-goo)"` attribute inside an `<svg>` (see `thinkingOrbsHtml()` in `map_state.js`), never CSS `filter: url(#…)` on HTML elements — WebKit renders the latter wrong.

**Non-blocking external stylesheets use `media="print"`, not `rel="preload"`.** Chrome checks a
few seconds after `load` whether every `rel="preload"` was actually used; the `as="style"` +
`rel` swap only happens in the sheet's own `onload`, which on a slow connection lands after that
check, so each visit logged `preloaded using link preload but not used within a few seconds`.
`<link rel="stylesheet" media="print" onload="this.media='all'">` downloads at low priority
without blocking render and never triggers the warning.

**Viewport meta is comma-separated.** A missing comma silently invalidates `viewport-fit=cover`, which zeroes every `env(safe-area-inset-*)`.

## Known Constraints

- No build system or package manager
- No automated tests (manual QA only)
- Must serve via HTTP server (not `file://`) to avoid CORS
- Large GeoJSON files (>5MB) impact initial load time
- Wikipedia API rate limits may affect equipment lookup
- Mobile performance requires throttling equipment queries
