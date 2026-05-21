# Pulse — Privacy Policy

**Last updated:** 2026-05-21

## What this extension does

Pulse is a Chrome extension that shows your current absence.io work-time status in the browser, reminds you to take legally required breaks (German ArbZG §4), and reminds you once when you cross 8 hours of work time. It calls the absence.io API on your behalf using a personal API key you provide.

## Data collected

This extension collects only what is required to function. All data stays on your device.

- **Your absence.io API key** (Key Identifier and secret Key): stored locally in `chrome.storage.local`. Never transmitted to any server other than `app.absence.io`.
- **Your absence.io user ID**: fetched once during setup and cached locally. Used only to read and write your own time entries.
- **Your work session state**: stored locally (clocked-in flag, elapsed time, last sync timestamp). Never leaves your device.
- **Your UI preferences**: language, overlay position, site denylist. Stored locally.

## Data sharing

Pulse sends data only to `https://app.absence.io`, which is the absence.io REST API operated by Atoss Software AG. Pulse does not transmit data to any other server, third-party analytics provider, or any other party. There is no Pulse backend.

## Permissions

Pulse requests the minimum Chrome permissions required for its function:

- `storage` — to save your API key and preferences locally.
- `alarms` — to schedule periodic background polls of absence.io.
- `notifications` — to show clock-out and break reminders.
- `idle` — to back off polling when your machine is idle.
- `offscreen` — to briefly play the break-reminder chime (service workers cannot play audio directly in Manifest V3).
- `host_permissions` for `https://app.absence.io/*` — to call the absence.io API. This is the only host Pulse can communicate with.

## Data retention

All data is stored in your browser's local storage. You can delete it at any time by removing the extension or by clicking "Disconnect" on the options page.

## Open source

Pulse is open-source under the MIT license. Source code is available at <https://github.com/wasimjalali2004-art/pulse-absence-io>.

## Contact

Questions or concerns: open an issue at the GitHub repository linked above. Note that the project is unmaintained and no support is offered.
