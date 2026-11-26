# Report: Community photo incident reporting

- **Date:** 2026-11-27 (Asia/Bangkok)
- **Overall status:** Partially complete: feature implemented, automated checks pass; browser verification and commits unavailable.

## 1. Summary
Added a Thai incident reporting page for sharing a photo, reporting flood conditions, or requesting assistance. Reports persist in SQLite and appear in a latest-reports list with reference IDs and unverified labels. Saving reports does not contact responders.

## 2. What Was Done
| # | Subtask | Commit | Status |
|---|---------|--------|--------|
| 1 | Add validated incident storage, photo retrieval and API | Blocked by .git permissions | Implemented, checked |
| 2 | Add photo form, optional geolocation, preview and recent reports | Blocked by .git permissions | Implemented, syntax checked |
| 3 | Add storage and handler tests and usage documentation | Blocked by .git permissions | Tests pass |
| 4 | Record final report | Blocked by .git permissions | Written |

Checklist: [x] backend; [x] frontend; [x] automated verification; [x] report; [ ] browser/device checks; [ ] separate commits.

## 3. Problems Encountered and Resolutions
- Git staging and commits failed with Permission denied creating .git/index.lock. Environment permits reading .git but not writing it. No permission bypass attempted. Work remains uncommitted.
- Real loopback HTTP smoke verification failed with WinError 10013 (socket access forbidden). Test subprocess was stopped. Added handler-level verification with in-memory HTTP streams and a real temporary SQLite database instead.

## 4. Remaining Work / Limitations
### Actual verification
- Python unittest discovery: 27 passed, including real SQLite persistence and validation.
- JavaScript syntax checks passed for reports.js; existing dashboard test suite: 14 passed.
- git diff --check passed.
### Mock verification
- Handler tests simulate HTTP streams/server/collector startup; exercise page routes, create/list/photo endpoints, malformed input, unknown image and cross-origin rejection. This is not an actual HTTP/browser run.
- Existing dashboard suite uses fake DOM/Leaflet.
- Small signature fixture is used in storage tests; handler tests use an embedded PNG byte fixture. Images are not decoded by the backend.
### Unverified / product limits
- Camera, geolocation permissions, responsive layout and submission in a real browser remain unverified.
- Server still binds only to loopback. Mobile network access and HTTPS deployment are not configured.
- Local prototype has no external alerts, responder dispatch, contact fields, account verification, moderation, report deletion or resolution workflow.
- Image checks enforce size and JPEG/PNG signatures; no full decoding or EXIF stripping. Public upload hardening/rate limiting/retention remains future work.
- No claim of help being received: UI explicitly says reports are recorded only and are unverified.

## 5. Recommendations / Next Steps
Restart the app and verify the complete form in a browser. Configure authorized public hosting, privacy controls and a responder workflow before accepting real assistance requests. Commit backend, frontend, verification/docs separately and this report last once git writes are available.

## 6. How to Verify
1. Run `python -m unittest discover -s tests`.
2. Run `node --check web/reports.js` and `node --test tests/dashboard.test.cjs`.
3. Restart `python app.py` and open http://127.0.0.1:8000/report.
4. Select a JPEG/PNG, enter location and details, consent and submit. Confirm reference ID and recent listing; restart and verify persistence.
5. Try invalid files, oversized images, denied geolocation and submission failures; confirm useful errors and retained form data.
