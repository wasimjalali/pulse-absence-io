# Pulse

**See your work hours in your browser, and never forget to clock out.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Chrome Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Status](https://img.shields.io/badge/status-archived-inactive)

A Chrome extension for [absence.io](https://www.absence.io/) users. Shows your current work time in the browser toolbar, fires a one-time clock-out reminder after 8 hours, and nudges you to take a break (German ArbZG §4) at 5h and 5h30 of continuous work.

> **Status: archived, unmaintained.** Built for an internal use case that is no longer active. Released here as a reference for anyone using absence.io who wants a browser-resident time tracker. Fork freely. No support, no roadmap, no PRs will be reviewed.

Bilingual (Deutsch / English). Default language is German.

## What it does

- **Floating widget** on every page while you're clocked in, with live elapsed time. Auto-hidden on banking and password-manager sites by default.
- **Toolbar badge** with live work time, colour-coded (green / amber / red).
- **Clock-out reminder** at 8 hours via OS notification, with snooze.
- **Break reminders** at 5h and 5h30 of continuous work, in line with German Working Hours Act (ArbZG §4).
- **Pop-out floating window** (Document Picture-in-Picture) for multi-monitor users.
- **Per-user API keys.** No backend. No analytics. Credentials stay on the user's device.

## Architecture

- Manifest V3. TypeScript strict.
- Vite + `@crxjs/vite-plugin` for bundling.
- Hawk SHA-256 request signing implemented directly with `crypto.subtle` in `src/background/hawk-signer.ts` (no `@hapi/hawk` dependency, it has no browser build).
- Service worker owns the state machine (`UNCONFIGURED → IDLE → WORKING → WARNED → SNOOZED`) and polls absence.io on alarms (1 min while working, 5 min while idle, exponential backoff on failure).
- Closed Shadow DOM for the content-script overlay so page styles and scripts can't reach it.
- No frontend framework. Plain DOM in popup, options, and content script.
- No backend. Extension talks directly to `https://app.absence.io/api/v2/`.
- `host_permissions` is exactly `https://app.absence.io/*`. The extension is incapable of fetching any other host.

## Install (development)

```bash
npm install
npm run build   # one-shot, or `npm run dev` for vite watch mode
```

Then load `dist/` as an unpacked extension at `chrome://extensions`.

## Install (prebuilt zip)

Grab `pulse-1.0.0.zip` from the [Releases](https://github.com/wasimjalali/pulse-absence-io/releases) page. In Chrome:

1. Unzip somewhere.
2. Open `chrome://extensions`, enable "Developer mode".
3. Click "Load unpacked", select the unzipped folder.

## First-time setup

1. Open the Pulse popup (toolbar icon) → "Open setup page".
2. In absence.io, go to *User Settings → Integrations* and click **Generate API Key**.
3. Paste the **Key Identifier** and **Key** into Pulse's setup page.
4. Done. The toolbar badge will start tracking once you clock in (via the popup, the floating widget, or directly on app.absence.io).

## API endpoints used

All endpoints below `https://app.absence.io/api/v2/`:

| Action | Method | Path |
|---|---|---|
| Identify user | `POST` | `/users` |
| List today's time entries | `POST` | `/timespans` (with filter body) |
| Clock in | `POST` | `/timespans/create` |
| Clock out | `PUT` | `/timespans/{id}` |

Pinned from the official absence.io [Postman collection](https://docs.absence.io/).

## License

MIT. See [LICENSE](LICENSE).

## Not affiliated with absence.io

This is an independent third-party extension. absence.io is a registered service of Atoss Software AG. Use at your own risk.
