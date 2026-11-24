# Report: Interactive station street map

- **Date:** 2026-11-24 (Asia/Bangkok)
- **Overall status:** Implementation and checks complete; commits blocked by filesystem permissions.

## 1. Summary
Replaced the station coordinate scatterplot with a Leaflet 1.9.4 street map using OpenStreetMap tiles. Users can drag, zoom, return to KMITL, fit filtered stations and click a station to see its current reading and recorded history. The separate forecast wind visualization is unchanged.

## 2. What Was Done
Checklist: replace station map; verify filters/history/failure behavior; record report last.

| # | Subtask | Commit | Status |
|---|---------|--------|--------|
| 1 | Add interactive street map, popup and controls | Blocked; intended `feat: replace station plot with interactive street map` | Implemented and browser verified |
| 2 | Verify map filtering, polling, history, errors and text safety | Blocked; intended `test: cover street map filtering and failure states` | Tests passed |
| 3 | Record this report last | Blocked; intended `docs: report interactive station map verification` | Written |

## 3. Problems Encountered and Resolutions
- `git add` and `git commit` for each subtask failed with `.git/index.lock: Permission denied`. No permission or security settings were changed. No commits were created.
- Global SVG styling could interfere with Leaflet's overlay; chart styling is now scoped to the original chart containers.
- If the Leaflet CDN fails, the station table and history remain available, and the map area explains how to recover. Tile errors display a message. Current station overlays are cleared on failed API refresh.
- Map instances persist across polling. Automatic refresh does not reset the user's zoom; filter changes and the fit button recalculate the extent.

## 4. Remaining Work / Limitations
### Actual browser verification
- Opened the existing user-running server at http://127.0.0.1:8000.
- Observed loaded street tiles with Thai road/place labels, attribution, KMITL reference and station dots.
- Selected a station from the table: its popup and real archived history appeared (four observations in the selected range).
- Used the return-to-KMITL button and directly clicked a station marker: popup and history appeared.
- Browser displayed live feed timestamps; upstream feeds were not independently revalidated by shell networking during this task.

### Automated verification with mocks
- `node --check web/dashboard.js`: passed.
- `node --test tests/dashboard.test.cjs`: 8 passed, using fake DOM, Leaflet and fetch implementations, not a real tile server.
- `python -m unittest discover -s tests -v`: 23 passed, including mocked upstream feeds and temporary database tests.
- `git diff --check`: passed.

### Limits
- Mobile layout, touch gestures and large regional marker density were not manually browser-tested.
- Leaflet CSS/JS are loaded from a pinned CDN with SRI. Street tiles require internet; no offline tiles or satellite imagery were added.
- Marker colors represent data freshness, not flood risk. No new hydraulic routing or warning thresholds were introduced.
- Station markers may overlap at regional zoom levels; users can zoom in. No clustering dependency was added.

## 5. Recommendations / Next Steps
Refresh the dashboard to load the new static assets. Commit the two implementation files, then the test file, then this report in the normal terminal. For a public/high-traffic deployment choose a tile provider appropriate to expected traffic and its terms.

## 6. How to Verify
```powershell
node --check web/dashboard.js
node --test tests/dashboard.test.cjs
python -m unittest discover -s tests -v
python app.py
```
Open the dashboard, drag/zoom the map, select each feed, filter local/regional stations, click a station, and confirm history appears. Check the home/fit buttons. Disconnect internet to check tile-loading messages while the station table remains usable.

Implementation references: https://leafletjs.com/examples-v1/quick-start/ and https://operations.osmfoundation.org/policies/tiles/ . Browser requests use standard tile caching/referrer behavior and visible attribution; no prefetching was added.
