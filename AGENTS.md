# Repository Guidelines

## Project Structure & Module Organization
- `index.html`: Entry point for the Leaflet-based map UI.
- `static/js/main.js`: Core map logic, URL param handling, data fetch/render.
- `static/js/equipment_parser.js`: Parses equipment text; fetches Wikipedia summaries.
- `static/js/shape_utils.js`: Shared helpers for shape parsing and geodesic calculations.
- `static/css/main.css`: UI styles for map, popups, controls, and mobile.
- Data: `joseph_w.geojson` (primary), `joseph_w-20250806.geojson` (snapshot), `submarinecablemap-cdn-json-20250618.json`, and related JSON.
- Utilities: `download_googlemap.js` (bookmarklet to export Google Maps data as GeoJSON), `classify_layer.py` (lists GeoJSON layer names).
- Assets: `static/assets/`, `favicon.ico`, `robots.txt`.

## Build, Test, and Development Commands
- Run locally (no build step): `python3 -m http.server 8080` then open `http://localhost:8080`.
- Alternative server: `npx serve` (if Node is available).
- Validate layers: `python3 classify_layer.py` (edit the filename inside as needed).

## URL Parameter Reference
- Basic search: `lat`/`lng` or `coords=lat,lng` center the map (path suffix `/lat,lng` still works). Omit radius to default 100 km (50 km when coordinates supplied).
- Range & filters: `radius=` (numeric, km by default) and optional `layer=` to preselect a layer filter.
- Shape mode: `shape=` accepts `point`, `circle`, `line`, `polygon`, `bbox`, `sector`, or `multi`. Supply shared options `unit=nm|km|m` (affects `radius`) and `text=` for popup labels.
- Inline coordinates for shapes use `lng,lat` pairs separated by semicolons. `line=` and `poly=` accept these lists; `bbox=` expects `west,south,east,north`.
- Circle/sector inputs read `lat`, `lng`, and `radius`; sectors also need `start`/`end` bearings (degrees, clockwise from north).
- Multi-shape mode supports multiple values: repeat `circle=lng,lat,r`, `line=...`, `poly=...`, and `sector=lng,lat,r,start,end` to render several overlays at once (radius scaled by `unit`).

## Coding Style & Naming Conventions
- JavaScript: ES6+, browser-only, 2-space indent, use `const`/`let`, avoid adding dependencies/frameworks. Keep functions small and side-effect scoped.
- CSS: Class-based selectors, keep existing naming; organize related rules together; prefer 2–4 space indent consistently.
- Filenames: JS helpers `lower_snake_case.js`; data as `.geojson`. Keep public URLs in a single constant (near the top of `main.js`). Do not hardcode secrets.

## Testing Guidelines
- No test framework; do manual QA:
  - Load map, verify markers, filters, and mobile behaviors.
  - Check URL params: `?lat=…&lng=…&radius=…&layer=…` update map state.
  - Watch DevTools console for errors and network failures (CORS, 404).
- Optional data validation (if installed): `jq . joseph_w.geojson`.

## Commit & Pull Request Guidelines
- Commits: concise imperative subject with scope, e.g., `map: improve URL parsing`, `data: refresh joseph_w.geojson`, `style: refine popup`.
- PRs: clear description, linked issues, before/after screenshots or GIFs, note data sources and file sizes. Keep diffs focused; avoid unrelated reformatting.

## Security & Configuration Tips
- Serve via a local server to avoid CORS issues. All APIs used must be public; no credentials.
- Large files impact load time—prefer CDN-hosted data, compress when >5MB, and document provenance.

## Agent-Specific Instructions
- Keep changes minimal and in-scope; do not introduce build tools. Preserve structure and style; update this guide if conventions change.
