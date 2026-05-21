export const API_BASE = 'https://app.absence.io/api/v2';

// Polling intervals
export const POLL_INTERVAL_WORKING_MS = 60_000;        // 1 min while clocked in
export const POLL_INTERVAL_IDLE_MS = 5 * 60_000;       // 5 min while idle
export const MACHINE_IDLE_THRESHOLD_SEC = 30 * 60;     // back off when machine idle > 30 min

// Work-time thresholds
export const CLOCK_OUT_THRESHOLD_HOURS = 8;
export const BADGE_AMBER_THRESHOLD_HOURS = 5;

// Badge colors — Pulse palette (deep teal / amber / coral)
export const COLOR_GREEN = '#0F8674';
export const COLOR_AMBER = '#C97A1A';
export const COLOR_RED = '#C24E3A';
export const COLOR_WARN = '#C24E3A';   // badge "!" for errors

// Alarm names (must be stable — used as keys in chrome.alarms)
export const ALARM_POLL = 'nh-poll';
export const ALARM_SNOOZE = 'nh-snooze';
export const ALARM_MIDNIGHT = 'nh-midnight';

// Notification IDs (each ID overwrites itself on re-fire)
export const NOTIFICATION_ID = 'nh-clock-out';
export const BREAK_NOTIFICATION_ID = 'nh-break-reminder';

// Snooze duration
export const SNOOZE_MINUTES = 30;

// Backoff caps. Period multiplier = min(2 ** consecutiveFailures, MAX_BACKOFF_MULT).
// At MAX_BACKOFF_MULT=30 the WORKING-state poll backs off from 1 min to 30 min
// after enough failures; IDLE backs off from 5 min to a cap of MAX_BACKOFF_MIN.
export const MAX_BACKOFF_MULT = 30;
export const MAX_BACKOFF_MIN = 30;

// absence.io's API validates start/end against its own wall clock with no
// tolerance. A machine that's even a few ms ahead of the server triggers a
// 412 "End date cannot be in the future" on clock-out (and the analogous
// failure on clock-in). Subtract this buffer from any wall-clock timestamp
// we POST so the value is reliably in the server's past, even with modest
// clock drift.
export const API_CLOCK_SKEW_BUFFER_MS = 5_000;
