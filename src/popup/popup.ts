import type { Message, StateResponse, WorkState, TodayState } from '../shared/types';
import { loadMessages } from '../shared/i18n';
import { getStorage, setStorage } from '../shared/storage';

// ── DOM refs ──────────────────────────────────────────────────────────────────

function qs<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`popup.html is missing #${id}`);
  return el as T;
}

const viewLoading      = qs<HTMLDivElement>('view-loading');
const viewUnconfigured = qs<HTMLDivElement>('view-unconfigured');
const viewMain         = qs<HTMLDivElement>('view-main');

const stateDot         = qs<HTMLSpanElement>('state-dot');
const stateLabel       = qs<HTMLSpanElement>('state-label');
const elapsedTime      = qs<HTMLDivElement>('elapsed-time');
const elapsedMeta      = qs<HTMLDivElement>('elapsed-meta');
const lastSync         = qs<HTMLSpanElement>('last-sync');

const progressTrack    = qs<HTMLDivElement>('progress-track');
const progressFill     = qs<HTMLDivElement>('progress-fill');

const btnStampIn       = qs<HTMLButtonElement>('btn-stamp-in');
const btnStampOut      = qs<HTMLButtonElement>('btn-stamp-out');
const btnOpenOptions   = qs<HTMLButtonElement>('btn-open-options');
const btnSettings      = qs<HTMLButtonElement>('btn-settings');
const actionMessage    = qs<HTMLDivElement>('action-message');
const overlayToggle    = qs<HTMLInputElement>('toggle-overlay');
const pipToggle        = qs<HTMLInputElement>('toggle-pip');

// ── State holders ─────────────────────────────────────────────────────────────

let tickInterval: ReturnType<typeof setInterval> | null = null;
// closedBeforeMs = sum of today's closed work spans only (no open span). The
// big counter shows the current open session, mirroring absence.io's native
// timer. Day total (for the 8h threshold and progress bar) is closedBeforeMs
// plus the live current-session elapsed.
let closedBeforeMs = 0;
let liveStampInTs: number | null = null;
let lastSyncedAt = 0;
let thresholdMs = 8 * 3_600_000;
let t: Awaited<ReturnType<typeof loadMessages>>;

// ── Formatters ────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatSyncAgo(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return t.syncedJustNow;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return t.syncedMinutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  return t.syncedHoursAgo(hours);
}

// ── Ticker (elapsed counter + progress + over-threshold colouring) ────────────

function updateOverThreshold(elapsed: number): void {
  const ratio = elapsed / thresholdMs;
  elapsedTime.classList.toggle('over', ratio >= 1 && ratio < 1.15);
  elapsedTime.classList.toggle('over-strong', ratio >= 1.15);
  progressFill.classList.toggle('over', ratio >= 1 && ratio < 1.15);
  progressFill.classList.toggle('over-strong', ratio >= 1.15);
  progressFill.style.width = `${Math.min(ratio * 100, 100)}%`;
}

function tickOnce(): void {
  if (liveStampInTs === null) return;
  const currentSession = Date.now() - liveStampInTs;
  elapsedTime.textContent = formatElapsed(currentSession);
  // Threshold colour + progress bar still track the day total, so a user who
  // already worked 7 h earlier today crosses 8 h after only 1 h on the clock.
  updateOverThreshold(closedBeforeMs + currentSession);
  if (lastSyncedAt > 0) lastSync.textContent = formatSyncAgo(lastSyncedAt);
}

function startTicker(): void {
  if (tickInterval !== null) return;
  tickInterval = setInterval(tickOnce, 1000);
}

function stopTicker(): void {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// ── View rendering ────────────────────────────────────────────────────────────

function stateLabelText(s: WorkState): string {
  switch (s) {
    case 'WORKING': return t.clockedIn;
    case 'WARNED':  return t.timeToLeave;
    case 'SNOOZED': return t.snoozed;
    case 'IDLE':
    case 'UNCONFIGURED':
    default:        return t.notClockedIn;
  }
}

function stateDotClass(s: WorkState, clocked: boolean): string {
  if (s === 'WARNED')  return 'state-dot dot-warned';
  if (s === 'SNOOZED') return 'state-dot dot-snoozed';
  if (clocked)         return 'state-dot dot-working';
  return 'state-dot dot-idle';
}

function showView(name: 'loading' | 'unconfigured' | 'main'): void {
  viewLoading.hidden      = name !== 'loading';
  viewUnconfigured.hidden = name !== 'unconfigured';
  viewMain.hidden         = name !== 'main';
}

function renderState(workState: WorkState, todayState: TodayState): void {
  if (workState === 'UNCONFIGURED') {
    stopTicker();
    showView('unconfigured');
    return;
  }

  showView('main');

  const isClockedIn = todayState.isClockedIn;
  stateLabel.textContent = stateLabelText(workState);
  stateDot.className     = stateDotClass(workState, isClockedIn);

  btnStampIn.hidden  = isClockedIn;
  btnStampOut.hidden = !isClockedIn;

  lastSyncedAt = todayState.lastSyncedAt;
  lastSync.textContent = lastSyncedAt > 0 ? formatSyncAgo(lastSyncedAt) : '';

  if (isClockedIn && todayState.stampInTimestamp !== null) {
    liveStampInTs = todayState.stampInTimestamp;
    // elapsedMsToday at poll time = closed_today + (lastSyncedAt - stampInTs).
    // Subtract the poll-time open-span slice to recover the closed-only total.
    const openAtPoll = Math.max(0, todayState.lastSyncedAt - todayState.stampInTimestamp);
    closedBeforeMs = Math.max(0, todayState.elapsedMsToday - openAtPoll);

    const currentSession = Date.now() - liveStampInTs;
    elapsedTime.textContent = formatElapsed(currentSession);

    const startTxt = `${t.startedAt} ${formatClock(todayState.stampInTimestamp)}`;
    // "Bis HH:MM" = when the current session must end so the day total hits
    // the 8h threshold. With closed_today already on the clock, the budget for
    // the current session is (threshold - closed). Floor at "now" so we never
    // project into the past for users already over the threshold.
    const projected = Math.max(Date.now(), liveStampInTs + thresholdMs - closedBeforeMs);
    const endTxt   = `${t.projectedEnd} ${formatClock(projected)}`;
    elapsedMeta.innerHTML = `${escape(startTxt)}<span class="sep">·</span>${escape(endTxt)}`;

    progressTrack.hidden = false;
    updateOverThreshold(closedBeforeMs + currentSession);
    startTicker();
  } else {
    stopTicker();
    liveStampInTs = null;
    closedBeforeMs = 0;
    progressTrack.hidden = true;
    elapsedTime.classList.remove('over', 'over-strong');

    if (todayState.elapsedMsToday > 0) {
      elapsedTime.textContent = formatElapsed(todayState.elapsedMsToday);
      elapsedMeta.textContent = t.todayTotal;
    } else {
      elapsedTime.textContent = '0:00:00';
      elapsedMeta.textContent = '';
    }
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

let actionMessageTimer: ReturnType<typeof setTimeout> | null = null;
function showActionMessage(text: string, isError = false): void {
  actionMessage.textContent = text;
  actionMessage.className   = `action-message${isError ? ' error' : ''}`;
  actionMessage.hidden      = false;
  if (actionMessageTimer !== null) clearTimeout(actionMessageTimer);
  // Errors stay 12 s so the actual server response is readable; successes
  // stay only 3 s so they don't clutter the UI.
  actionMessageTimer = setTimeout(
    () => { actionMessage.hidden = true; actionMessageTimer = null; },
    isError ? 12000 : 3000,
  );
}

function setButtonsDisabled(disabled: boolean): void {
  btnStampIn.disabled  = disabled;
  btnStampOut.disabled = disabled;
}

// ── Message helpers ───────────────────────────────────────────────────────────

function sendMessage(msg: Message): Promise<StateResponse> {
  return chrome.runtime.sendMessage(msg) as Promise<StateResponse>;
}

// ── Apply i18n strings to elements with data-i18n attribute ──────────────────

function applyI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset['i18n'];
    if (!key) return;
    const value = (t as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string') el.textContent = value;
  });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

btnOpenOptions.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

btnSettings.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

overlayToggle.addEventListener('change', () => {
  void (async () => {
    const prefs = await getStorage('preferences');
    await setStorage('preferences', { ...prefs, overlayEnabled: overlayToggle.checked });
  })();
});

pipToggle.addEventListener('change', () => {
  void (async () => {
    const prefs = await getStorage('preferences');
    await setStorage('preferences', { ...prefs, pipEnabled: pipToggle.checked });
  })();
});

btnStampIn.addEventListener('click', () => {
  setButtonsDisabled(true);
  showActionMessage(t.clockingIn);
  void sendMessage({ type: 'STAMP_IN' }).then((resp) => {
    if (resp) {
      renderState(resp.workState, resp.todayState);
      if (resp.error) showActionMessage(resp.error, true);
      else            showActionMessage(t.clockedInOk);
    }
    setButtonsDisabled(false);
  }).catch(() => {
    showActionMessage(t.errorConnection, true);
    setButtonsDisabled(false);
  });
});

btnStampOut.addEventListener('click', () => {
  setButtonsDisabled(true);
  showActionMessage(t.clockingOut);
  void sendMessage({ type: 'STAMP_OUT' }).then((resp) => {
    if (resp) {
      renderState(resp.workState, resp.todayState);
      if (resp.error) showActionMessage(resp.error, true);
      else            showActionMessage(t.clockedOutOk);
    }
    setButtonsDisabled(false);
  }).catch(() => {
    showActionMessage(t.errorConnection, true);
    setButtonsDisabled(false);
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────

showView('loading');

(async () => {
  t = await loadMessages();
  const prefs = await getStorage('preferences');
  thresholdMs = prefs.clockOutThresholdHours * 3_600_000;
  overlayToggle.checked = prefs.overlayEnabled;
  pipToggle.checked = prefs.pipEnabled;
  // Document Picture-in-Picture is a Chromium-only API. Hide the toggle on
  // browsers that do not expose it (Firefox, Safari) so users do not toggle a
  // feature that has no effect there. Same code runs on Chrome, Edge, Brave,
  // Arc, DIA, Opera, Vivaldi.
  if (!('documentPictureInPicture' in window)) {
    const pipRow = document.getElementById('row-toggle-pip');
    if (pipRow !== null) pipRow.hidden = true;
  }
  applyI18n();

  try {
    const resp = await sendMessage({ type: 'GET_STATE' });
    if (resp) renderState(resp.workState, resp.todayState);
    else showView('unconfigured');
  } catch {
    showView('unconfigured');
  }

  // Reset session-dismiss so the pill reappears when the user opens the popup.
  // chrome.tabs.sendMessage doesn't require the "tabs" permission.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      chrome.tabs.sendMessage(tab.id, { type: 'RESET_OVERLAY_DISMISS' }).catch(() => {});
    }
  } catch { /* chrome:// pages, extension pages, etc. have no content script */ }
})();
