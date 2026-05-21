import {
  ALARM_POLL,
  ALARM_SNOOZE,
  ALARM_MIDNIGHT,
  POLL_INTERVAL_WORKING_MS,
  POLL_INTERVAL_IDLE_MS,
  MACHINE_IDLE_THRESHOLD_SEC,
  SNOOZE_MINUTES,
  NOTIFICATION_ID,
  BREAK_NOTIFICATION_ID,
  MAX_BACKOFF_MULT,
  MAX_BACKOFF_MIN,
  API_CLOCK_SKEW_BUFFER_MS,
} from '../shared/constants';
import { getStorage, setStorage, resetTodayState } from '../shared/storage';
import { fetchTodayTimespans, createTimespan, closeTimespan, ApiError } from './absence-client';
import { updateBadge, setBadgeError, clearBadge } from './badge-controller';
import { loadMessages } from '../shared/i18n';
import type { WorkState, TodayState, Timespan, Message, StateResponse } from '../shared/types';

// ── Alarm helpers ─────────────────────────────────────────────────────────────

function reschedulePoll(state: WorkState, consecutiveFailures = 0): void {
  if (state === 'UNCONFIGURED') {
    void chrome.alarms.clear(ALARM_POLL);
    return;
  }
  const isActive = state === 'WORKING' || state === 'WARNED';
  const basePeriod = isActive
    ? POLL_INTERVAL_WORKING_MS / 60_000
    : POLL_INTERVAL_IDLE_MS / 60_000;
  // Exponential backoff on consecutive API failures, capped so we still
  // recover within half an hour once absence.io comes back.
  const multiplier = Math.min(2 ** consecutiveFailures, MAX_BACKOFF_MULT);
  const periodInMinutes = Math.min(basePeriod * multiplier, MAX_BACKOFF_MIN);
  chrome.alarms.create(ALARM_POLL, { periodInMinutes });
}

function scheduleMidnight(): void {
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  chrome.alarms.create(ALARM_MIDNIGHT, { when: midnight.getTime() });
}

// ── Elapsed time computation ──────────────────────────────────────────────────

function computeElapsed(
  timespans: Timespan[],
  now: number,
): { elapsedMs: number; openSpan: Timespan | null } {
  let elapsedMs = 0;
  let openSpan: Timespan | null = null;

  // fetchTodayTimespans returns a 48-hour window. Filter to today UTC for
  // closed spans (yesterday's closed work doesn't belong in today's elapsed),
  // but accept any open span — an overnight clock-in started yesterday is
  // still the current shift, and its full duration should drive the 8h check.
  const todayStartMs = new Date(new Date(now).setUTCHours(0, 0, 0, 0)).getTime();

  for (const span of timespans) {
    if (span.type !== 'work') continue;
    const start = new Date(span.start).getTime();
    if (!span.end) {
      elapsedMs += now - start;
      openSpan = span;
    } else if (start >= todayStartMs) {
      elapsedMs += new Date(span.end).getTime() - start;
    }
  }

  return { elapsedMs, openSpan };
}

// Continuous work since the last break end (or current shift start). Drives
// the 5h / 5h30 break-reminder nudges that keep users compliant with ArbZG §4.
//
// Anchored on the CURRENT open work span — any closed spans before it belong
// to a previous shift (a clock-out then clock-in is itself an implicit break)
// and must not inflate the continuous count. This also protects against the
// 48h API window pulling yesterday's spans into today's calculation.
function computeContinuousWorkSinceBreak(
  timespans: Timespan[],
  now: number,
): { continuousMs: number; latestBreakEndMs: number } {
  let openSpanStartMs: number | null = null;
  for (const span of timespans) {
    if (span.type !== 'work' || span.end) continue;
    const startMs = new Date(span.start).getTime();
    if (openSpanStartMs === null || startMs > openSpanStartMs) openSpanStartMs = startMs;
  }

  if (openSpanStartMs === null) return { continuousMs: 0, latestBreakEndMs: 0 };

  // Only breaks that ended after the current shift started count — older
  // breaks belong to a prior shift that was already terminated by clock-out.
  let latestBreakEndMs = 0;
  for (const span of timespans) {
    if (span.type !== 'break' || !span.end) continue;
    const endMs = new Date(span.end).getTime();
    if (endMs > openSpanStartMs && endMs > latestBreakEndMs) latestBreakEndMs = endMs;
  }

  const effectiveStart = Math.max(openSpanStartMs, latestBreakEndMs);
  const continuousMs = Math.max(0, now - effectiveStart);
  return { continuousMs, latestBreakEndMs };
}

// ── Notification ──────────────────────────────────────────────────────────────

async function fireClockOutNotification(): Promise<void> {
  const t = await loadMessages();
  chrome.notifications.create(NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/icons/icon-128.png'),
    title: t.notificationTitle,
    message: t.notificationBody,
    buttons: [
      { title: t.notificationClockOut },
      { title: t.notificationSnooze(SNOOZE_MINUTES) },
    ],
    requireInteraction: true,
  });
}

async function fireBreakReminderNotification(stage: 'first' | 'final', continuousHours: number): Promise<void> {
  const t = await loadMessages();
  const message = stage === 'first'
    ? t.breakNotificationBodyFirst(continuousHours.toFixed(continuousHours % 1 ? 1 : 0))
    : t.breakNotificationBodyFinal;
  // Chrome notifications are OS-level — they appear regardless of which tab
  // or window is focused, satisfying the "visible from anywhere" requirement.
  // silent:false lets macOS play its default notification sound when the
  // user has "Play sound for notifications" enabled for Chrome.
  chrome.notifications.create(BREAK_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/icons/icon-128.png'),
    title: t.breakNotificationTitle,
    message,
    buttons: [{ title: t.breakNotificationDismiss }],
    priority: stage === 'final' ? 2 : 1,
    requireInteraction: stage === 'final',  // final stage stays sticky
    silent: false,
  });

  // Branded experience on top of the bare OS banner: a Pulse-themed modal in
  // the active tab and a synthesized chime. Both are best-effort — if the
  // user has no browser tab focused, or no audio device, the OS banner alone
  // is still the canonical notification.
  void playBreakSound(stage);
  void showBreakModal(stage, continuousHours);
}

// ── Offscreen audio (service workers cannot play audio directly) ──────────────

async function ensureOffscreenAudio(): Promise<void> {
  // chrome.offscreen.hasDocument is the modern check; older Chrome versions
  // expose only createDocument and throw if a doc already exists.
  const offscreen = chrome.offscreen as unknown as {
    hasDocument?: () => Promise<boolean>;
    createDocument: (opts: { url: string; reasons: string[]; justification: string }) => Promise<void>;
  };
  if (offscreen.hasDocument) {
    if (await offscreen.hasDocument()) return;
  }
  try {
    await offscreen.createDocument({
      url: 'src/background/offscreen-audio.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play break-reminder chime — service workers cannot play audio directly.',
    });
  } catch {
    // Race: a parallel call already created it. Safe to ignore.
  }
}

async function playBreakSound(stage: 'first' | 'final'): Promise<void> {
  try {
    await ensureOffscreenAudio();
    await chrome.runtime.sendMessage({ type: 'PLAY_BREAK_SOUND', stage });
  } catch {
    // Audio is non-critical. Never let a sound failure mask the notification.
  }
}

// ── In-page branded modal (sent to the active browser tab) ────────────────────

async function showBreakModal(stage: 'first' | 'final', hours: number): Promise<void> {
  try {
    // Target the active tab of every NORMAL browser window (excludes popups,
    // devtools, the options page). lastFocusedWindow alone misses cases
    // where the user briefly focused the Pulse popup or options page.
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
    for (const win of windows) {
      const active = win.tabs?.find((t) => t.active);
      if (!active || active.id === undefined) continue;
      try {
        await chrome.tabs.sendMessage(active.id, { type: 'SHOW_BREAK_MODAL', stage, hours });
      } catch {
        // Tabs without our content script (chrome://, Web Store, devtools)
        // throw a "no receiver" error. Silent — OS banner already fired.
      }
    }
  } catch {
    // Windows query failed — non-critical, OS banner already fired.
  }
}

function clearNotification(): void {
  void chrome.notifications.clear(NOTIFICATION_ID);
}

// ── Core poll ─────────────────────────────────────────────────────────────────

async function runPoll(opts: { force?: boolean } = {}): Promise<void> {
  const creds = await getStorage('credentials');
  if (!creds) {
    clearBadge();
    return;
  }

  let currentState = await getStorage('workState');

  // Alarm-driven polls back off when the machine has been idle a while —
  // but only while the user is NOT clocked in. When clocked in we always
  // poll, because long meetings/reading sessions look like "machine idle"
  // to chrome.idle and we still need the 5h/5h30 break reminder to fire.
  // Explicit user actions (stamp-in/out, popup opens) pass force=true.
  const isClockedInState =
    currentState === 'WORKING' || currentState === 'WARNED' || currentState === 'SNOOZED';
  if (!opts.force && !isClockedInState) {
    const idleState = await chrome.idle.queryState(MACHINE_IDLE_THRESHOLD_SEC);
    if (idleState !== 'active') return;
  }
  if (currentState === 'UNCONFIGURED') {
    // Self-heal: an earlier 401/403 may have stuck workState in UNCONFIGURED
    // even though credentials are still present and may be valid again. Try
    // the poll anyway. If credentials are still bad, the 401/403 handler
    // below puts us right back in UNCONFIGURED with the "!" badge.
    const credsForRetry = await getStorage('credentials');
    if (credsForRetry === null) {
      clearBadge();
      return;
    }
    await setStorage('workState', 'IDLE');
    currentState = 'IDLE';
  }

  let timespans: Timespan[];
  try {
    timespans = await fetchTodayTimespans(creds);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      // 401 = invalid key; 403 = account no longer permitted to manage time
      // entries. Both require the user to revisit the options page.
      await setStorage('workState', 'UNCONFIGURED');
      await setStorage('consecutiveFailures', 0);
      reschedulePoll('UNCONFIGURED');
      setBadgeError();
      return;
    }
    // Network failure (status 0) and 5xx: keep last-known badge and state.
    // The next alarm tick retries on an exponentially backed-off cadence so
    // 30 users * 30 minutes of unreachable absence.io ≠ 30 × 30 × 60 requests.
    const failures = (await getStorage('consecutiveFailures')) + 1;
    await setStorage('consecutiveFailures', failures);
    reschedulePoll(currentState, failures);
    return;
  }

  // Success — clear any backoff state so the next alarm fires at the base cadence.
  const prevFailures = await getStorage('consecutiveFailures');
  if (prevFailures !== 0) {
    await setStorage('consecutiveFailures', 0);
  }

  const now = Date.now();
  const { elapsedMs, openSpan } = computeElapsed(timespans, now);
  const isClockedIn = openSpan !== null;

  const prefs = await getStorage('preferences');
  const thresholdMs = prefs.clockOutThresholdHours * 3_600_000;
  const overThreshold = isClockedIn && elapsedMs >= thresholdMs;

  // ── Break reminder (ArbZG §4) ──────────────────────────────────────────────
  // Track continuous work since the last break end. If the user crosses
  // threshold 1 (default 5h) or threshold 2 (default 5h30) without taking
  // a break in absence.io, fire an OS notification visible from any tab.
  // If a new break is detected (its end_ms exceeds the stored lastBreakEndMs),
  // the reminder flags reset so the next long stretch can re-trigger.
  const prevToday = await getStorage('todayState');
  const { continuousMs, latestBreakEndMs } = computeContinuousWorkSinceBreak(timespans, now);

  let breakReminder1Fired = prevToday.breakReminder1Fired;
  let breakReminder2Fired = prevToday.breakReminder2Fired;
  if (latestBreakEndMs > prevToday.lastBreakEndMs) {
    breakReminder1Fired = false;
    breakReminder2Fired = false;
  }

  if (isClockedIn) {
    const r1Ms = prefs.breakReminder1Hours * 3_600_000;
    const r2Ms = prefs.breakReminder2Hours * 3_600_000;
    if (!breakReminder2Fired && continuousMs >= r2Ms) {
      void fireBreakReminderNotification('final', prefs.breakReminder2Hours);
      breakReminder2Fired = true;
      breakReminder1Fired = true;   // skip the gentle one if we jumped past it
    } else if (!breakReminder1Fired && continuousMs >= r1Ms) {
      void fireBreakReminderNotification('first', prefs.breakReminder1Hours);
      breakReminder1Fired = true;
    }
  } else {
    // Stamp-out detected via the website (not the extension button) — reset
    // break-reminder bookkeeping so the next shift starts fresh, matching
    // what handleStampOut does for the in-extension path.
    breakReminder1Fired = false;
    breakReminder2Fired = false;
  }

  const todayState: TodayState = {
    isClockedIn,
    currentTimespanId: openSpan?._id ?? null,
    stampInTimestamp: openSpan ? new Date(openSpan.start).getTime() : null,
    elapsedMsToday: elapsedMs,
    lastSyncedAt: now,
    breakReminder1Fired,
    breakReminder2Fired,
    lastBreakEndMs: isClockedIn ? latestBreakEndMs : 0,
  };
  await setStorage('todayState', todayState);

  let newState: WorkState;
  if (!isClockedIn) {
    newState = 'IDLE';
    clearNotification();
    void chrome.alarms.clear(ALARM_SNOOZE);
  } else if (overThreshold) {
    if (currentState === 'WORKING') {
      newState = 'WARNED';
      void fireClockOutNotification();
    } else if (currentState === 'SNOOZED') {
      newState = 'SNOOZED'; // snooze alarm handles re-fire
    } else {
      newState = 'WARNED'; // already warned, stay warned
    }
  } else {
    newState = 'WORKING';
    if (currentState === 'WARNED' || currentState === 'SNOOZED') {
      clearNotification();
      void chrome.alarms.clear(ALARM_SNOOZE);
    }
  }

  if (newState !== currentState) {
    await setStorage('workState', newState);
    reschedulePoll(newState);
  } else if (prevFailures !== 0) {
    // Recovered from a backoff window without a state transition — still need
    // to reset the alarm cadence to the base period.
    reschedulePoll(newState);
  }

  updateBadge(elapsedMs, isClockedIn);
}

// ── Stamp in / out ────────────────────────────────────────────────────────────

function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Could not reach absence.io. Check your connection.';
    if (err.status === 401) return 'Credentials are no longer valid. Open setup to reconnect.';
    if (err.status === 403) return 'Your account is not allowed to manage time entries.';
    // While the API endpoints are still being verified against the live
    // service, surface the raw URL + body so any failing endpoint is
    // immediately visible in the popup/overlay toast.
    return err.message;
  }
  return 'Unexpected error. Try again.';
}

async function handleStampIn(): Promise<StateResponse> {
  const creds = await getStorage('credentials');
  if (!creds) return fetchStateResponse();

  // Refresh state first — popup may have stale data if user already clocked in elsewhere.
  await runPoll({ force: true });
  const currentToday = await getStorage('todayState');
  if (currentToday.isClockedIn) {
    return {
      workState: await getStorage('workState'),
      todayState: currentToday,
      error: "You're already clocked in on absence.io.",
    };
  }

  // Back off a few seconds from the wall clock so absence.io never sees the
  // start as "in the future" due to client/server clock skew. See
  // API_CLOCK_SKEW_BUFFER_MS in constants.ts for the rationale.
  const now = new Date(Date.now() - API_CLOCK_SKEW_BUFFER_MS);

  let timespan: Timespan;
  try {
    timespan = await createTimespan(creds, now);
  } catch (err) {
    return { ...(await fetchStateResponse()), error: describeApiError(err) };
  }

  const todayState: TodayState = {
    isClockedIn: true,
    currentTimespanId: timespan._id,
    stampInTimestamp: now.getTime(),
    elapsedMsToday: currentToday.elapsedMsToday,
    lastSyncedAt: now.getTime(),
    breakReminder1Fired: currentToday.breakReminder1Fired,
    breakReminder2Fired: currentToday.breakReminder2Fired,
    lastBreakEndMs: currentToday.lastBreakEndMs,
  };
  await setStorage('todayState', todayState);
  await setStorage('workState', 'WORKING');
  await setStorage('lastStampActionAt', Date.now());
  reschedulePoll('WORKING');
  updateBadge(todayState.elapsedMsToday, true);

  return { workState: 'WORKING', todayState };
}

async function handleStampOut(): Promise<StateResponse> {
  const creds = await getStorage('credentials');
  if (!creds) return fetchStateResponse();

  // Refresh state — currentTimespanId in cache may be stale (e.g., user
  // clocked out on the website, or the open span is from overnight which the
  // old today-only filter would have missed).
  await runPoll({ force: true });
  const todayState = await getStorage('todayState');

  if (!todayState.currentTimespanId || todayState.stampInTimestamp === null) {
    return { ...(await fetchStateResponse()), error: 'No open time entry to close.' };
  }

  // Back off the wall clock by the skew buffer so absence.io's "end cannot be
  // in the future" check passes even when the client clock is a few hundred
  // ms ahead of the server. Always keep end at least 1s after stamp-in so we
  // never invert the session (which would also fail server-side validation).
  const stampInMs = todayState.stampInTimestamp;
  const safeEndMs = Math.max(stampInMs + 1_000, Date.now() - API_CLOCK_SKEW_BUFFER_MS);
  const now = new Date(safeEndMs);
  const startTime = new Date(stampInMs);
  try {
    await closeTimespan(creds, todayState.currentTimespanId, startTime, now);
  } catch (err) {
    return { ...(await fetchStateResponse()), error: describeApiError(err) };
  }

  // Extend elapsed by time since last sync (covers gap between last poll and now)
  const elapsedMs = todayState.elapsedMsToday + (now.getTime() - todayState.lastSyncedAt);

  const newTodayState: TodayState = {
    isClockedIn: false,
    currentTimespanId: null,
    stampInTimestamp: null,
    elapsedMsToday: elapsedMs,
    lastSyncedAt: now.getTime(),
    // Clocking out fully resets the break-reminder bookkeeping — next shift starts fresh.
    breakReminder1Fired: false,
    breakReminder2Fired: false,
    lastBreakEndMs: 0,
  };
  await setStorage('todayState', newTodayState);
  await setStorage('workState', 'IDLE');
  await setStorage('lastStampActionAt', Date.now());
  clearNotification();
  void chrome.alarms.clear(ALARM_SNOOZE);
  void chrome.notifications.clear(BREAK_NOTIFICATION_ID);
  reschedulePoll('IDLE');
  clearBadge();

  return { workState: 'IDLE', todayState: newTodayState };
}

async function fetchStateResponse(): Promise<StateResponse> {
  const [workState, todayState] = await Promise.all([
    getStorage('workState'),
    getStorage('todayState'),
  ]);
  return { workState, todayState };
}

// ── Service worker wake-up ────────────────────────────────────────────────────

async function initOnWake(): Promise<void> {
  let workState = await getStorage('workState');
  // Self-heal at wake-up: if creds are present but we are stuck in
  // UNCONFIGURED from a past auth failure, optimistically flip to IDLE so
  // the first poll actually fires. The poll then validates against the
  // server and falls back to UNCONFIGURED only if creds are still rejected.
  if (workState === 'UNCONFIGURED') {
    const creds = await getStorage('credentials');
    if (creds !== null) {
      await setStorage('workState', 'IDLE');
      workState = 'IDLE';
    }
  }
  reschedulePoll(workState);
  if (workState !== 'UNCONFIGURED') {
    scheduleMidnight();
    void runPoll();
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    // Pulse v1 migration: an early bug left `overlayEnabled` stuck at false
    // for users who clicked Close — the host element was force-shown via
    // inline `display: block !important`, so the close handler's
    // `host.hidden = true` was a no-op. The pill kept rendering and the user
    // could never get back to a working state by toggling the preference.
    // After updating to the fixed version, restore the default-on behaviour.
    if (details.reason === 'update') {
      const prefs = await getStorage('preferences');
      const next = { ...prefs };
      let changed = false;
      if (prefs.overlayEnabled === false) {
        next.overlayEnabled = true;
        changed = true;
      }
      // Migrate users who had the now-removed 'pill' shape. Reset to circle.
      if ((prefs as { overlayShape?: string }).overlayShape === 'pill') {
        next.overlayShape = 'circle';
        changed = true;
      }
      // Seed the new denylist field for users who upgrade from a build that
      // didn't have it. Empty arrays count as "user emptied it" and stay.
      if ((prefs as { overlayDenylistedHosts?: unknown }).overlayDenylistedHosts === undefined) {
        next.overlayDenylistedHosts = [
          'accounts.google.com',
          'login.microsoftonline.com',
          'login.live.com',
          '*.paypal.com',
          '*.1password.com',
          '*.bitwarden.com',
          '*.lastpass.com',
          '*.dashlane.com',
        ];
        changed = true;
      }
      if (changed) await setStorage('preferences', next);
    }
    await initOnWake();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void initOnWake();
});

// Watches credentials writes from the options page. When credentials become
// available, transition out of UNCONFIGURED (if still there) and kick off the
// first poll. Storage events for a key that was never set deliver
// `oldValue: undefined`, which is why a workState UNCONFIGURED→IDLE check
// would miss the very first save.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const credsChange = changes['credentials'];
  if (credsChange === undefined || !credsChange.newValue) return;

  void (async () => {
    const workState = await getStorage('workState');
    if (workState === 'UNCONFIGURED') {
      await setStorage('workState', 'IDLE');
      reschedulePoll('IDLE');
    } else {
      reschedulePoll(workState);
    }
    scheduleMidnight();
    await runPoll();
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_POLL) {
    void runPoll();
    return;
  }

  if (alarm.name === ALARM_MIDNIGHT) {
    void (async () => {
      // Schedule tomorrow's midnight FIRST. If the SW is evicted mid-handler,
      // the reset still happens on time next day rather than waiting for the
      // next user-triggered wake.
      scheduleMidnight();
      await resetTodayState();
      await setStorage('workState', 'IDLE');
      clearBadge();
      clearNotification();
      void chrome.alarms.clear(ALARM_SNOOZE);
      void runPoll({ force: true });
    })();
    return;
  }

  if (alarm.name === ALARM_SNOOZE) {
    void (async () => {
      // Pull fresh state — user may have stamped out via the website during
      // the 30-minute snooze, in which case we must not re-fire.
      await runPoll({ force: true });
      const [todayState, prefs] = await Promise.all([
        getStorage('todayState'),
        getStorage('preferences'),
      ]);
      if (!todayState.isClockedIn) return;
      const thresholdMs = prefs.clockOutThresholdHours * 3_600_000;
      if (todayState.elapsedMsToday >= thresholdMs) {
        await setStorage('workState', 'WARNED');
        reschedulePoll('WARNED');
        void fireClockOutNotification();
      } else {
        await setStorage('workState', 'WORKING');
        reschedulePoll('WORKING');
      }
    })();
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as Message;

  if (msg.type === 'GET_STATE') {
    void (async () => {
      // Force a fresh poll if state is stale (covers popup-opened-right-after-onboarding
      // and "I clocked in on the website 10 seconds ago" cases).
      const [creds, today] = await Promise.all([
        getStorage('credentials'),
        getStorage('todayState'),
      ]);
      const stale = creds !== null && Date.now() - today.lastSyncedAt > 30_000;
      if (stale) await runPoll({ force: true });
      sendResponse(await fetchStateResponse());
    })();
    return true;
  }
  if (msg.type === 'STAMP_IN') {
    void handleStampIn().then(sendResponse);
    return true;
  }
  if (msg.type === 'STAMP_OUT') {
    void handleStampOut().then(sendResponse);
    return true;
  }
  if (msg.type === 'OPEN_OPTIONS') {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'SNOOZE_NOTIFICATION') {
    void (async () => {
      await setStorage('workState', 'SNOOZED');
      chrome.alarms.create(ALARM_SNOOZE, { delayInMinutes: SNOOZE_MINUTES });
      clearNotification();
      sendResponse(await fetchStateResponse());
    })();
    return true;
  }

  return false;
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId === BREAK_NOTIFICATION_ID) {
    void chrome.notifications.clear(BREAK_NOTIFICATION_ID);
    return;
  }
  if (notificationId !== NOTIFICATION_ID) return;
  if (buttonIndex === 0) {
    void handleStampOut();
    clearNotification();
  } else {
    void (async () => {
      await setStorage('workState', 'SNOOZED');
      chrome.alarms.create(ALARM_SNOOZE, { delayInMinutes: SNOOZE_MINUTES });
      clearNotification();
    })();
  }
});

// User dismisses the notification without clicking a button → treat as snooze
chrome.notifications.onClosed.addListener((notificationId, byUser) => {
  if (notificationId !== NOTIFICATION_ID || !byUser) return;
  void (async () => {
    await setStorage('workState', 'SNOOZED');
    chrome.alarms.create(ALARM_SNOOZE, { delayInMinutes: SNOOZE_MINUTES });
  })();
});
