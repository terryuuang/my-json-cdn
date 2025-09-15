# Repository Guidelines

## Project Structure & Module Organization
- `index.html`: Entry point for the Leaflet-based map UI.
- `static/js/main.js`: Core map logic, URL param handling, data fetch/render.
- `static/js/equipment_parser.js`: Parses equipment text; fetches Wikipedia summaries.
- `static/css/main.css`: UI styles for map, popups, controls, and mobile.
- Data: `joseph_w.geojson` (primary), historical snapshots, and related JSON.
- Utilities: `app.js` (GeoJSON exporter from page data), `classify_layer.py` (lists GeoJSON layer names).
- Assets: `static/assets/`, `favicon.ico`, `robots.txt`.

## Build, Test, and Development Commands
- Run locally (no build step): `python3 -m http.server 8080` then open `http://localhost:8080`.
- Alternative server: `npx serve` (if Node is available).
- Validate layers: `python3 classify_layer.py` (edit the filename inside as needed).

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

