# LinkPulse — Link Management MVP

**Team:** YUKTI-x  
**Stack:** HTML5, CSS3, vanilla JavaScript  
**Data store:** browser `localStorage`  
**Project type:** static frontend prototype for a college hackathon demonstration

LinkPulse brings short-link creation, campaign grouping, lifecycle rules, safety controls, QR codes, CSV tools, and click-event analytics into one interface. The app is deliberately frontend-only: it demonstrates the workflow without pretending to provide secure server-side enforcement.

## Folder structure

```text
LinkPulse/
├── index.html    # Semantic page shell and external script/style references
├── styles.css    # Responsive layout, components, forms, and status styling
├── app.js        # Data access, views, link rules, campaigns, analytics, CSV, QR, and redirects
└── README.md     # Setup, walkthrough, limitations, and QA notes
```

## Run locally

1. Extract the `LinkPulse.zip` file.
2. Open the folder in VS Code.
3. Start a static server using the **Live Server** extension and open `index.html` through that server. You can also host the folder on a static host such as GitHub Pages.
4. Keep the site open in the same browser profile while creating and testing links. Link records are stored in that browser's local storage.

You may try opening `index.html` directly, but static-server hosting is recommended for more predictable URL handling and browser storage. There is no npm install, compilation, backend, or database setup required by the project.

## Key features

- **Overview dashboard:** live summary cards, recent activity, top links, campaign performance, and an activity chart derived from stored click events.
- **Link creation and editing:** HTTP/HTTPS URL validation, generated or custom aliases, title, campaign, tags, expiry, positive-integer click cap, and an optional demonstration-only password gate.
- **Static-compatible short URLs:** links use the current app base plus `?go=alias`. The redirect view checks the alias, disabled state, expiry, click cap, current domain blocklist, and optional password before recording a successful click and navigating.
- **Link management:** search title/alias/destination, filter status and campaign, sort records, view details, copy/test the URL, generate a QR code, edit, disable/re-enable, and delete.
- **Campaigns:** create and edit uniquely named campaigns, group links, inspect click totals, and open campaign-filtered analytics. Deleting a campaign leaves its links in place and removes their campaign association.
- **Analytics:** last 7 days, last 30 days, or all retained events; campaign filter; click activity; top-performing links; referrer and device categories. The dashboard's lifetime clicks are stored on link records, while range-based charts use retained click events.
- **QR codes:** QR output uses the generated **short URL**. The QR feature loads QRCode.js from jsDelivr; if the library cannot load, the app shows a clear message and other features remain usable.
- **CSV export/import:** escaped CSV export of link definitions; CSV import preview with URL, alias, campaign, expiry, and cap validation. Invalid rows are skipped with a report. Click history and password values are not imported.
- **Safety and administration:** local domain blocklist, current host checks on redirect, and immediate demo disable/re-enable actions.
- **Sample data:** load clearly identified example campaigns, links, and clicks, then remove the demo data without removing user-created records.
- **Responsive and accessible UI:** desktop sidebar, mobile navigation, labeled inputs, focus states, status text, and inline validation.

## How the short-link flow works

1. Create a campaign (optional), then create a link with a destination.
2. Copy the generated URL, which uses the format `https://your-static-host/path/?go=your-alias`.
3. Open it in the **same browser profile and same host/origin** where the record was created.
4. The app loads the alias from browser storage and rechecks the link's current rules.
5. If all rules allow it, a click event is saved before the browser navigates to the destination.
6. Open Analytics to view the event.
7. Disable the link on the Links or Safety page and open the same short URL again. The redirect view should report that the link is unavailable; earlier clicks remain available until the link itself is deleted.

A conventional short URL such as `/abc123` requires a server route. This demo instead uses a query parameter so it can be served as a static site.

## CSV format

Exported headers are:

```csv
Title,Alias,Destination,Campaign,Tags,Status,Expiry,ClickLimit,ClickCount
```

For import, the required columns are `Title`, `Alias`, and `Destination`. Optional columns are `Campaign`, `Tags`, `Status`, `Expiry`, and `ClickLimit`. A supplied campaign name must match a campaign that already exists in the workspace. `ClickCount` is exported for reference but is not imported as historical analytics; imported links start with zero clicks. Password values are never exported or imported. Values containing commas, double quotes, or newlines are supported by the CSV parser.

## Browser data and deletion policy

All data is stored under the `linkpulse.database.v1` localStorage key. It is local to a browser profile and origin, not shared across users or devices. Up to 5,000 click events and 100 activity entries are retained to prevent unbounded event growth. Each link record keeps a lifetime click counter for click-cap enforcement and link totals.

Deleting a link also deletes its retained click events, so it no longer contributes to analytics. Disabling or expiring a link does not delete its history. Deleting a campaign keeps its links and click history but clears the campaign association.

## Security and production limitations

This is a demo MVP, not a production-safe URL service.

- **No real authentication or authorization:** administrative controls are visible client-side and can be bypassed by editing JavaScript or localStorage.
- **Password gates are not secure:** the demonstration password is stored in browser data. Do not enter a real password or sensitive information.
- **No server-side redirect:** the destination navigation is performed by client-side JavaScript.
- **No globally atomic click cap:** synchronous browser checks work for simple demonstrations, but tabs, devices, or users cannot share a trusted atomic counter.
- **No multi-user synchronization:** links and campaigns exist only in that browser profile/origin.
- **No durable asynchronous analytics pipeline:** browser event logging is local and limited to retained events; it does not provide an event queue or guaranteed server-side delivery.
- **Limited traffic insight:** browser/referrer/device categories are only basic client-side hints. Direct navigation and privacy controls can leave the referrer blank. There is no precise location, identity, unique-visitor, or sophisticated bot detection.
- **No robust server-side abuse prevention or rate limiting:** these need a trusted backend.
- **External QR dependency:** QR generation relies on the QRCode.js CDN script. The rest of the app remains usable if it fails.

A production version should move authentication, authorization, password verification, canonical alias routing, redirect checks, atomic click limits, abuse controls, durable click logging, and administrative takedowns to a trusted backend and database. The current UI and data models provide a starting point for that integration.

## QA notes

The following checks were performed during this build:

- `node --check app.js` completed without a JavaScript syntax error.
- The HTML structure was parsed; static IDs were unique, references to IDs used by the app were found, and local CSS/JS references existed.
- The CSS stylesheet was parsed with no declaration/rule parse errors reported.
- A headless Chromium test harness exercised 24 interactions, including initial load, demo data, campaign creation, custom alias creation, duplicate-alias rejection, unsafe-scheme rejection, redirect decision logic, click recording, disabled/expired/capped links, password-gate success/failure, current blocklist enforcement, analytics, CSV import with quoted commas, CSV download, QR dependency fallback, and a narrow mobile viewport. These checks passed in the harness.

**Test-environment limitation:** the environment's Chromium policy blocked direct navigation to the local static server and file URLs. The interactive tests therefore loaded the app markup, CSS, and JavaScript inline, used a test storage shim, and captured the redirect destination in place of performing a real cross-site navigation. This validates much of the UI and rule logic, but it does **not** prove the unmodified static app's origin-specific localStorage behaviour or actual destination navigation on a live static host. The QRCode.js CDN also did not load in the test environment, so its graceful fallback was verified; QR image generation itself was not verified here. Run the extracted project with VS Code Live Server and check QR generation with an internet connection before a live presentation.

A browser-only prototype cannot verify backend-scale guarantees because no backend is present.
