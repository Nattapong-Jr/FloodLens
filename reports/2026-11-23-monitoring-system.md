# Report: Regional water and weather monitoring system

- **Date:** 2026-11-23 (Asia/Bangkok)
- **Overall status:** Implementation complete for this increment; browser validation of the new dashboard and successful live collection on the new server remain pending restart in the user's normal terminal. Commits blocked by filesystem permissions.

## 1. Summary

Expanded FloodLens from a snapshot viewer into a local monitoring application with SQLite history, a background collector, regional station context, signed flow observations, and multi-point rain/wind forecasts. Added a station-coordinate view, history charts/export, collector status, and the official TMD storm widget with source links. This increment does not calculate water routing, arrival times, incoming water totals, or a cyclone trajectory from wind vectors.

## 2. What Was Done

Initial checklist: extend regional feeds; add archive and collector; build dashboard and preserve CSV; verify; document and commit report last.

Repository was clean at start. Existing baseline: `0d2d878` (previous verification report), `3bfc451` (verified connectivity docs), `08c97ea` (diagnostics), `bd3ccb6` (agent workflow). User's workflow is preserved unchanged.

| # | Subtask | Commit | Status |
|---|---------|--------|--------|
| 1 | Extend ThaiWater to signed flow observations and regional scope; request five weather points including wind | Blocked; intended `feat: add regional flow and multi-point wind feeds` | Code and parser tests complete; live upstream responses inspected |
| 2 | Add persistent archive, idempotent observations, fresh paired trends and background polling | Blocked; intended `feat: archive observations with background polling` | Python tests and offline CLI execution verified |
| 3 | Build station/history/weather dashboard and preserve `/csv` | Blocked; intended `feat: add regional monitoring dashboard` | Syntax and mock-DOM tests passed; real browser rendering pending |
| 4 | Update docs and CI for Python/Node tests | Blocked; intended `docs: describe monitoring operations and source limits` | Files reviewed; hosted CI not executed |
| 5 | Write this report last | Blocked; intended `docs: report monitoring system implementation` | Report prepared |

### Implementation details

- Four feeds: ThaiWater `waterlevel_load`, `rain_24h`, `flow`; Open-Meteo multi-location forecast.
- Regional geography is a 150 km circle centered on the same approximate KMITL coordinates (13.73, 100.78). Local view filters to 10 km. Neither circle is an administrative boundary or drainage catchment.
- Feed identity and measurement units remain distinct. Flow values can be negative and are not interpreted as a cardinal direction. Agency, district, province, river and basin metadata are retained when supplied.
- Forecast locations: KMITL, Pathum Thani, Ayutthaya, Chachoengsao, central Bangkok. Wind is from 10 m forecast fields, km/h; `wind_to_deg` is `(wind_from_deg + 180) % 360`.
- SQLite `observations` keys: feed/station/time. Repeated fetches do not duplicate an observation. Corrections at the same time replace the previous payload. Forecasts never enter the observation table.
- Latest snapshot and up to 1,000 recent collection-status records persist. Observation history is not silently purged. Database/WAL/SHM files are excluded from git.
- Poller runs immediately on server startup, then waits 300 seconds after a collection completes. It operates without an open webpage, but requires the Python process to stay running. It is not installed as a Windows Service.
- Reads use archived snapshots rather than waiting on upstream networking. Status `pending` is explicit. API errors clear the current feed but leave historical observations available.
- Staleness is recomputed on every view, including after restart. Snapshots older than 15 minutes are marked stale; observations older than three hours or more than 15 minutes in the future are marked stale.
- Trends use only two fresh actual measurements with a gap of at most three hours. There is no calculated trend for rolling 24-hour rain totals, no rain-total summing across stations, and no inflow-total summing across gauges.
- API endpoints: `/api/live?scope=local|regional`, `/api/history?feed=water|rain|flow&station_id=...&hours=1..720`, `/api/health`, original `/api/data`.
- CLI adds `--db` and `--collect-once`; existing `--check-live` remains.
- Station history CSV export and original `/csv` are separate. Geographic station plot contains no guessed canal connectivity.
- TMD widget uses the iframe URL officially shown in the installation instructions, `/StromTrack`. There is a direct-link fallback. Its storm coordinates are not parsed or fed into calculations.

## 3. Problems Encountered and Resolutions

### Problem 1: commit permission denied

- **Symptom:** `git add` and `git commit` failed with `Unable to create .../.git/index.lock: Permission denied` after the first verified subtask.
- **Cause:** Agent's `.git` access is read-only in this execution environment.
- **Resolution:** Left the scoped edits available; did not modify permissions, delete lock files or use another channel to bypass restrictions. Further commits and report commit remain blocked. No new hashes are claimed.
- **Status:** Unresolved environment limitation.

### Problem 2: network restrictions and new-server browser test

- **Symptom:** Shell could not retrieve live upstream data; new server at port 8001 started but in-app browser navigation timed out.
- **Cause:** Agent environment/network isolation; the exact OS mechanism was not determined. Previous user-run server at 8000 is a separate execution context.
- **Resolution:** Verified upstream response schemas through the allowed browser. Asked the user to restart the normal terminal server; user answered that they had not restarted it. Continued Python and mock-DOM validation independently. Stopped the temporary test server afterwards.
- **Status:** New dashboard real-browser/end-to-end verification pending user-run server restart. Did not claim it passed.

### Problem 3: storm widget URL

- **Symptom:** The widget documentation page includes full navigation and is not the embedding target.
- **Resolution:** Read the visible disabled installation textbox and embedded frame on the official page. It explicitly provides `<iframe src="https://www.tmd.go.th/StromTrack" ...>`. Updated the dashboard button to load that URL, not `/weatherWidget/StromTrack`.
- **Status:** Embed target confirmed; actual widget within FloodLens not yet browser-verified. TMD can be slow and may restrict embedding later.

## 4. Remaining Work / Limitations

### Verified with real sources

- Direct ThaiWater `public/flow` response included `flow_datetime`, signed `flow_value`, `station.flow_lat`, `flow_long`, `flow_name`, `flow_oldcode`. Examples observed: FW.LKB.01 / ปตร.ลาดกระบัง = 0; FW.PWT.03 / คลองประเวศบุรีรมย์ ตอนถนนร่วมพัฒนา = 3.13 at 21:05 on 2026-11-23. Values are a point-in-time observation, not a promise of current conditions.
- BMA's flow table labels the discharge unit as cubic metres per second. The feed also contained old records from 2024/2025, confirming why staleness must be surfaced.
- Open-Meteo returned five ordered locations with 72 hourly records each for the current three-calendar-day request and expected precipitation/wind units. Wind-direction samples included 360 degrees; conversion uses modulo arithmetic.
- Official TMD widget documentation and its iframe were visible in the browser. No claim was made that an active cyclone was present or headed toward Bangkok.
- KMITL and government drainage references were read before describing regional context. Direction can change with operational pumping/diversion; no permanent upstream/downstream edges were invented.

### Verified with synthetic test data

- Python: 23 tests passed, including duplicate/corrected observation handling, persistence across new Store instances, missing vs zero, signed flow, scopes/cache isolation, wind conversion, historical bounds, database errors, stale trends and API/CLI contracts.
- Node: four mock-DOM tests passed for local/regional filtering and signed display, station-history selection, clearing current values after refresh failures, and empty search results.
- `node --check web/dashboard.js` and `git diff --check` passed.
- `--collect-once` was executed with an isolated temporary database. It created the database, reported all upstream feeds as errors in this restricted shell, archived zero observations, and exited 1. This is an error-path validation, not a successful live ingestion test.

### Not yet verified / not implemented

- Full browser rendering, visual layout, chart interactions, CSV download and TMD embedding in the new FloodLens dashboard have not been verified in the real browser. Mock DOM tests do not replace these checks.
- New poller + real upstream + successful SQLite write as a combined live run still requires the user to restart their normal server. The implementation has not secretly used captured data as live data.
- Hosted GitHub Actions workflow has been edited but not run.
- No Windows Service, public deployment, authentication, multi-user access, notifications or production web server was added; server still binds to localhost.
- No numerical water-routing model, upstream arrival estimate, live gate/pump controls, tidal feed, or cyclone track-coordinate ingestion was added. No correlation is presented as proof of water movement.
- History starts now; no historical backfill. Forecasts are not archived as observations or forecast vintages. No observation retention limit or automatic database backup is implemented yet.
- Default regional scope is an implementation assumption for context, not a claim that all these stations feed Bangkok or Lat Krabang. The weather coordinates are representative city points, not basin rainfall averages.

## 5. Recommendations / Next Steps

1. Restart the user's normal `python app.py` and verify `/api/health` and all four feeds. Keep the process running for at least two source measurement times to populate real history/trends.
2. Verify dashboard desktop/mobile rendering and the external storm widget. If the widget fails, use its direct official link rather than infer storm motion from surface wind.
3. Run a 24-hour collection trial, inspect missing/stale coverage and database growth, then define retention and backup needs.
4. To estimate incoming water, obtain a reviewed canal/river graph, gauge direction conventions, gate openings, pump telemetry and downstream/tidal levels. Validate against known events before calculating arrival or flood warnings.
5. To calculate cyclone proximity, connect a supported official advisory/track data source with timestamped positions and uncertainty. Keep this separate from local 10 m wind forecasts.

Suggested commits from an authorized normal terminal (review diff first):

```powershell
git add floodlens/live.py tests/test_live.py
git commit -m "feat: add regional flow and multi-point wind feeds"
git add floodlens/store.py floodlens/monitor.py app.py tests/test_monitor.py .gitignore
git commit -m "feat: archive observations with background polling"
git add web/index.html web/dashboard.js web/csv.html tests/dashboard.test.cjs
git commit -m "feat: add regional monitoring dashboard"
git add README.md .github/workflows/tests.yml
git commit -m "docs: describe monitoring operations and source limits"
git add reports/2026-11-23-monitoring-system.md
git commit -m "docs: report monitoring system implementation"
```

## 6. How to Verify

```powershell
python -m unittest discover -s tests -v
node --check web/dashboard.js
node --test tests/dashboard.test.cjs
python app.py --collect-once
python app.py
```

After stopping any older server with Ctrl+C, open http://127.0.0.1:8000. Check the collector badge, switch 10/150 km scopes, select Flow and a gauge, wait for distinct measurement times and inspect history. Confirm `/api/health` contains four feeds and `/api/history?feed=water&station_id=3&hours=48` contains only actual stored water observations. `--collect-once` exits 0 only when all four regional feeds have data; empty/error returns 1.

Source references:

- https://api-v3.thaiwater.net/api/v1/thaiwater30/public/flow
- https://weather.bangkok.go.th/Flow/
- https://open-meteo.com/en/docs
- https://www.tmd.go.th/weatherWidget/StromTrack
- https://www.opre.kmitl.ac.th/main/?page_id=2059
- https://edunakhonsawan.prd.go.th/th/content/category/detail/id/33/iid/547207
