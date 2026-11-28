# Report: Help workflow and station failures

- **Date:** 2026-11-28
- **Overall status:** Complete

## 1. Summary

FloodLens now has separate public flood reports and private help requests. The coordinator can receive, assign, and close a case, and the reporter can track its status. The homepage also shows recent campus incidents and keeps cached readings visible when station updates fail.

## 2. What Was Done

| # | Subtask | Commit | Status |
|---|---|---|---|
| 1 | Split the homepage actions | `dac4bea` | Done |
| 2 | Add a private text-first help form | `53c8df6` | Done |
| 3 | Add coordinator access and reporter tracking | `f68cbd4` | Done |
| 4 | Distinguish source failure from an empty filter result | `83ca95e` | Done |
| 5 | Add searchable campus reports, a map, and confirmation times | `119c216` | Done |
| 6 | Preserve form data and deduplicate retries | `a5c5876` | Done |

## 3. Problems Encountered and Resolutions

The process listening on port 8000 returned HTTP 404 for `/help` while the checkout already defined the route. Replacing the running process with a new process launched from the checkout restored access. After the final restart, both `/` and `/report` contained links to `/help`, and the route and its scripts returned HTTP 200.

Station retrieval failures previously discarded the last snapshot or made failures look like empty filters. The collector now retains the previous readings and retrieval time, and the homepage distinguishes failed, empty, and successfully filtered results.

## 4. Verification and Limitations

- **Real HTTP:** Verified routes on port 8000. The live regional API returned water, rain, and flow with `ok` status and retrieval timestamps at about 18:53 ICT.
- **Real HTTP and SQLite with synthetic inputs:** Started the final checkout on an isolated port with a temporary database. Submitted a request for two people at a dorm gate without photo or GPS data. The same retry key returned the same receipt. A coordinator accepted the case. The tracking endpoint returned the accepted status and timestamp without contact or location. The public report feed stayed empty and the tracking credential could not open the queue.
- **Automated coverage:** 30 Python tests and 16 Node tests passed. Station outage tests used simulated upstream failures and a minimal fake DOM. The lost response test simulated a dropped connection. The HTTP smoke test used a real listener and no substituted handlers.
- **Environment limits:** Browser access was unavailable, so no physical phone or rendered browser walkthrough was completed. The smoke test left no synthetic request in the port 8000 database.
- **Defaults and assumptions:** Campus listings include GPS reports within 10 km and text-only locations as reported. The campus view marks reports awaiting updates after six hours. Older archives may retain measurement times without a recorded last retrieval time. In-flight drafts are held in the open tab.

## 5. Recommendations / Next Steps

Configure a coordinator key and confirm the team name, hours, and callback channel before opening a real pilot. Use two devices to verify the rendered reporter and coordinator flows with the pilot configuration.

## 6. How to Verify

Run `python -m unittest discover -s tests` and `node --test tests/dashboard.test.cjs tests/submission.test.cjs`. Start the app with the coordinator key and an isolated database. Open the help form from both the homepage and public report page. Submit the two-person scenario with no GPS, follow the receipt link, accept the request in `/coordinator`, and refresh the tracking page.
