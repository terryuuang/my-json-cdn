# App installation and offline support

Open the **App** button at the bottom left of the map for installation instructions,
download status, sharing and updates. Installation never opens an automatic modal.
Android browsers that provide an install prompt use it directly. On iOS, use the
browser Share menu → Add to Home Screen → Add; retain “Open as Web App” when offered.
The dialog also works on desktop and restores keyboard focus when closed.

The service worker requires HTTPS or localhost. Root deployment is assumed by the
existing manifest ID, scope, service worker and asset URLs.

## Offline behaviour

After preparation finishes, the versioned app shell, pinned Leaflet / drawing /
OpenCC dependencies, icon fonts and the main GeoJSON can open without a network.
Coordinate and shape links share the cached HTML shell; their query parameters and
hashes remain intact. Notes continue to use their existing IndexedDB storage.
The App panel reports whether the main dataset exists and when it was cached;
this is a download timestamp, not a source publication timestamp.

Only published local files under `geojson/` and `static/geojson/` are cached as data.
The main dataset is retained with at most 24 additional files. Google tiles,
weather, AIS, remote searches, analytics and other external requests are not
archived. Offline point overlays can therefore appear without a basemap. Browser
storage eviction can remove downloaded data; this is not a guaranteed offline map
package. “Clear downloaded data” preserves the app shell and personal notes.

## Updates

Bump `APP_VERSION` in `sw.js` when cached assets change. Keep the manifest and UI
fallback version aligned. Required assets install as a group; a failed download
must not replace the previous working version. Data caching has a separate cache
name so an app update does not discard downloaded data.

A downloaded update waits for the user or for all old tabs to close. The requesting
tab serializes its current shareable map view into the URL and reloads only after
`controllerchange`. Unsaved drawings / unfinished note edits must be saved first.
Other open tabs are not forcibly reloaded.

## Device QA

1. On iPhone / iPad Safari, open App, follow installation guidance, then launch from
   the home screen. Verify status-bar and home-indicator clearance in both orientations.
2. On Android Chrome, install through App and check that launcher masking keeps the
   logo intact. Confirm that installed mode hides installation instructions.
3. Wait for “地理資料已儲存”, enable airplane mode, close and reopen the app; verify
   downloaded points, notes and a URL containing circle/polygon parameters.
4. Reconnect; check a new deployment. Verify that declining to update preserves the
   current view and applying the update reloads once with the current link intact.
5. Test native sharing and cancellation, clipboard fallback, clearing downloads,
   dark mode, reduced motion, large text and keyboard focus in the App dialog.

Local Chromium automation covered iPhone/Android viewport emulation, an actually
stopped local server followed by an offline shape-link navigation, and update /
sharing / cache lifecycle checks. Viewport emulation does not replace testing
installation and OS chrome on physical iOS / Android devices.

## Artwork and platform references

`atlas-companion.webp` extends the existing geometric gorilla / map logo using
image generation, compressed to 960 × 640 WebP (about 44 KB). `app-maskable.svg`
keeps the original logo unchanged with padding for launcher masks; its rendered
`app-maskable-512.png` is the manifest icon. `launch-*.png` contains static branded
iOS launch layouts for the device-size media queries in `index.html`, in both
orientations. Unmatched screens still use the branded in-page loading indicator. No runtime image
generation or new build tooling is required. The old manifest's logo-as-screenshot
entries were removed because they were not screenshots of the app.

Platform behaviour follows [WebKit's Safari 26 web-app guidance](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
and [MDN's service-worker lifecycle documentation](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
