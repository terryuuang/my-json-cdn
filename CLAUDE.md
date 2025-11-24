# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Leaflet-based interactive map application (溫SINT地圖) that visualizes Chinese military and defense-related facilities from GeoJSON data. The application supports advanced geospatial search, custom shape overlays (no-fly zones), and equipment information lookup via Wikipedia.

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
2. **Loading**: `main.js` fetches GeoJSON via relative path (configurable via `DATA_BASE_URL`)
3. **Rendering**: Features filtered by radius/layer, rendered as Leaflet markers
4. **Equipment Enrichment**: `equipment_parser.js` extracts equipment names from feature properties, queries Wikipedia API for summaries
5. **Shape Overlays**: `shape_utils.js` parses URL parameters to render circles, polygons, lines, sectors, or multi-shape overlays

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

**`static/js/shape_utils.js`** (Geometry Utilities)
- Pure functions for coordinate parsing and geodesic calculations
- Supports `point`, `circle`, `line`, `polygon`, `bbox`, `sector`, `multi` shapes
- Unit conversion: nautical miles (`nm`), kilometers (`km`), meters (`m`)
- Distance calculations: point-to-line, point-in-polygon, bearing/sector checks

**`index.html`**
- Loads Leaflet 1.9.4, Leaflet.draw, PolylineMeasure plugins
- Control panel for manual coordinate input and layer filtering
- Mobile-responsive with tap-to-close panel behavior

**`download_googlemap.js`** (Bookmarklet)
- Browser script to extract Google Maps data and convert to GeoJSON
- Run on `mymaps.google.com` to export custom map layers
- Handles bidirectional text markers and multi-layer maps

**`classify_layer.py`**
- Python utility to list unique layer names from GeoJSON
- Edit `filename` variable inside script to target different files

### URL Parameter System

The application uses URL parameters for deep linking and state persistence:

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

**Shape Mode Behavior**:
- Defaults to hiding unit markers (`unitsVisible = false`)
- Filters features within specified distance from shape boundaries
- Updates control panel to reflect current state

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

## Known Constraints

- No build system or package manager
- No automated tests (manual QA only)
- Must serve via HTTP server (not `file://`) to avoid CORS
- Large GeoJSON files (>5MB) impact initial load time
- Wikipedia API rate limits may affect equipment lookup
- Mobile performance requires throttling equipment queries
