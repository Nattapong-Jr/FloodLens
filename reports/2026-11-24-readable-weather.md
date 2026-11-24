# Report: Readable rain and wind forecasts

- **Date:** 2026-11-24 (Asia/Bangkok)
- **Overall status:** Implementation and verification complete; commits blocked.

## 1. Summary
Replaced the weather coordinate/arrow diagram with an interactive OpenStreetMap street map and Thai forecast cards. Each point shows hourly rainfall, rain probability, wind blowing toward a named compass direction, and gust speed. The selected hour controls the map labels, popups, cards and optional comparison table.

## 2. What Was Done
Checklist: replace coordinate diagram; explain forecast values; verify selection and missing/error states; write report last.

| # | Subtask | Commit | Status |
|---|---------|--------|--------|
| 1 | Add weather street map and Thai forecast cards | Blocked; intended `feat: explain rain and wind with a street map and Thai cards` | Implemented and verified |
| 2 | Verify hourly selection, direction semantics and failure states | Blocked; intended `test: verify readable weather forecasts and missing data` | Passed |
| 3 | Record report last | Blocked; intended `docs: report readable weather verification` | Written |

## 3. Problems Encountered and Resolutions
- Git staging and commits fail with `.git/index.lock: Permission denied`. Each subtask commit was attempted; no commits were created and no permission settings were changed.
- The original SVG diagram required readers to interpret coordinates and arrows. The replacement shows street/place context and named areas with plain Thai wind direction text.
- Missing precipitation, probability, speed or direction is explicitly identified instead of being treated as zero. Calm wind is distinct from unknown direction. Feed failure removes weather cards/overlays; stale forecasts have a visible old-data label.
- The new second map required updating the existing map lifecycle test to expect two independent maps. A missing-probability test initially expected an ASCII dash but the existing formatter used an em dash; the UI was improved to say that data is unavailable and the assertion was updated accordingly.

## 4. Remaining Work / Limitations
### Actual browser checks
- Opened the existing user-running dashboard at http://127.0.0.1:8000.
- Observed loaded street map tiles and Thai labels for all five forecast points.
- Changed the selected time from 21:00 to 22:00 on 24 November 2026; the summary and cards updated. KMITL wind changed from 3.2 to 7.6 km/h in the displayed forecast.
- Clicked the KMITL card and observed a map popup showing the same selected time, rainfall, wind direction/speed, rain probability and gusts.
- Inspected the rendered desktop layout and five cards. No fabricated data was injected into the browser.

### Automated checks (mocks separated)
- JavaScript syntax check passed.
- 14 JavaScript tests passed using fake DOM, Leaflet and fetch implementations. Coverage includes selected-hour updates, Thai names, missing rain, calm/unknown wind, direction conversion, stale status, map/CDN/API failure, safe text labels and existing station behavior.
- 23 Python tests passed; these include mocked upstream responses and temporary SQLite archives, not new live upstream verification.
- `git diff --check` passed.

### Limits
- Browser checks used a desktop viewport; mobile/touch behavior was not manually verified.
- The existing KMITL hourly forecast chart remains. The old coordinate diagram and wind arrows were removed.
- Map colors indicate forecast rain/non-rain/missing values, not flood risk. Each named area represents a forecast reference point, not a province-wide forecast.
- Compass text describes the direction the wind blows toward, using eight compass sectors. It does not model cyclone movement.
- Internet is required for the existing Leaflet CDN and map tiles. If the map cannot load, forecast cards still work. No new providers or dependencies were added.

## 5. Recommendations / Next Steps
Refresh the dashboard. Select a forecast time, compare cards, and click a card to locate it on the map. Commit implementation, tests, then this report from the normal terminal when ready.

## 6. How to Verify
```powershell
node --check web/dashboard.js
node --test tests/dashboard.test.cjs
python -m unittest discover -s tests -v
python app.py
```
Open the dashboard and inspect the section titled `ฝนจะตกไหม ลมพัดไปทางไหน?`. Change the hour, compare map/card values, click a card, and expand the numeric comparison if needed.
