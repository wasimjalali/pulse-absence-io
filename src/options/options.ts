import { fetchCurrentUser, ApiError } from '../background/absence-client';
import {
  getStorage,
  setStorage,
  setStorageBatch,
  clearCredentials,
} from '../shared/storage';
import { loadMessages } from '../shared/i18n';
import type { Credentials, Permissions, Preferences, OverlayPosition } from '../shared/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function qs<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`options.html is missing #${id}`);
  return el as T;
}

function clean(s: string): string {
  return s.trim();
}

function setStatus(el: HTMLElement, message: string, type: 'info' | 'success' | 'error' | ''): void {
  el.textContent = message;
  el.className = `status ${type}`.trim();
}

// ── DOM refs ────────────────────────────────────────────────────────────────

const formCreds       = qs<HTMLFormElement>('credentials-form');
const hawkIdInput     = qs<HTMLInputElement>('hawk-id');
const hawkKeyInput    = qs<HTMLInputElement>('hawk-key');
const hawkIdCount     = qs<HTMLSpanElement>('hawk-id-count');
const hawkKeyCount    = qs<HTMLSpanElement>('hawk-key-count');
const submitBtn       = qs<HTMLButtonElement>('submit-btn');
const statusEl        = qs<HTMLDivElement>('status');

const connectCard     = qs<HTMLElement>('connect-card');
const connectedCard   = qs<HTMLElement>('connected-card');
const connectedUserId = qs<HTMLSpanElement>('connected-user-id');
const btnDisconnect   = qs<HTMLButtonElement>('btn-disconnect');

const formPrefs       = qs<HTMLFormElement>('preferences-form');
const langSelect      = qs<HTMLSelectElement>('pref-language');
const break1Input     = qs<HTMLInputElement>('pref-break-1');
const break2Input     = qs<HTMLInputElement>('pref-break-2');
const prefsStatus     = qs<HTMLDivElement>('prefs-status');

const overlayEnabledInput  = qs<HTMLInputElement>('pref-overlay-enabled');
const pipEnabledInput      = qs<HTMLInputElement>('pref-pip-enabled');
const overlayPositionInput = qs<HTMLSelectElement>('pref-overlay-position');
const overlayResetBtn      = qs<HTMLButtonElement>('pref-reset-position');
const denylistInput        = qs<HTMLTextAreaElement>('pref-overlay-denylist');
const denylistSaveBtn      = qs<HTMLButtonElement>('pref-denylist-save');
const denylistStatus       = qs<HTMLDivElement>('denylist-status');

// ── i18n cache (loaded once at boot, reloaded on language change) ──────────

let t: Awaited<ReturnType<typeof loadMessages>>;

function applyI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset['i18n'];
    if (!key) return;
    const value = (t as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string') el.textContent = value;
  });
  submitBtn.textContent = t.optionsVerifyBtn;
}

// ── credentials form ────────────────────────────────────────────────────────

function updateCharCount(input: HTMLInputElement, counter: HTMLSpanElement): void {
  const len = input.value.trim().length;
  counter.textContent = len > 0 ? `${len} ${t.optionsCharCountSuffix}` : '';
  if (input.id === 'hawk-id') {
    counter.className = `char-count${len > 0 && len !== 24 ? ' warn' : ''}`;
  }
}

function setSubmitting(active: boolean): void {
  submitBtn.disabled = active;
  submitBtn.textContent = active ? t.optionsVerifying : t.optionsVerifyBtn;
}

function showConnected(name: string, userId: string): void {
  connectedUserId.textContent = `${t.optionsUserIdLabel}: ${userId}`;
  connectedCard.hidden = false;
  connectCard.hidden = true;
}

async function handleSubmit(event: Event): Promise<void> {
  event.preventDefault();
  setStatus(statusEl, '', '');

  const hawkId = clean(hawkIdInput.value);
  const hawkKey = clean(hawkKeyInput.value);

  if (!hawkId || !hawkKey) {
    setStatus(statusEl, t.optionsBothFieldsRequired, 'error');
    return;
  }

  if (hawkId.length !== 24) {
    setStatus(statusEl, t.optionsKeyLengthWarn(hawkId.length), 'error');
    return;
  }

  setSubmitting(true);
  setStatus(statusEl, t.optionsConnecting, 'info');

  try {
    const tempCreds = { hawkId, hawkKey, userId: '' };
    const user = await fetchCurrentUser(tempCreds);

    if (!user.canManageTimetrackingEntries) {
      setStatus(statusEl, t.optionsNoPermission, 'error');
      return;
    }

    const credentials: Credentials = { hawkId, hawkKey, userId: user._id };
    const permissions: Permissions = {
      canManageTimetrackingEntries: user.canManageTimetrackingEntries,
      canManageFutureTimespans: user.canManageFutureTimespans,
      canSeeTimetracking: user.canSeeTimetracking,
      canUseTimetracking: user.canUseTimetracking,
    };

    await setStorageBatch({ credentials, permissions });

    setStatus(statusEl, t.optionsConnectedReady(`${user.firstName} ${user.lastName}`), 'success');
    showConnected(`${user.firstName} ${user.lastName}`, user._id);
    hawkKeyInput.value = '';
    updateCharCount(hawkIdInput, hawkIdCount);
    updateCharCount(hawkKeyInput, hawkKeyCount);
  } catch (err) {
    if (err instanceof ApiError) {
      if      (err.status === 401) setStatus(statusEl, t.optionsError401, 'error');
      else if (err.status === 403) setStatus(statusEl, t.optionsError403, 'error');
      else if (err.status === 0)   setStatus(statusEl, t.optionsErrorNetwork, 'error');
      else                         setStatus(statusEl, t.optionsErrorOther(err.status), 'error');
    } else {
      setStatus(statusEl, t.optionsErrorUnexpected, 'error');
    }
  } finally {
    setSubmitting(false);
  }
}

async function handleDisconnect(): Promise<void> {
  await clearCredentials();
  connectedCard.hidden = true;
  connectCard.hidden = false;
  hawkIdInput.value = '';
  hawkKeyInput.value = '';
  updateCharCount(hawkIdInput, hawkIdCount);
  updateCharCount(hawkKeyInput, hawkKeyCount);
  setStatus(statusEl, t.optionsDisconnected, 'info');
}

// ── preferences form ────────────────────────────────────────────────────────

async function loadPreferences(): Promise<void> {
  const prefs = await getStorage('preferences');
  langSelect.value           = prefs.language === 'en' ? 'en' : 'de';
  break1Input.value          = String(prefs.breakReminder1Hours);
  break2Input.value          = String(prefs.breakReminder2Hours);
  overlayEnabledInput.checked = prefs.overlayEnabled;
  pipEnabledInput.checked     = prefs.pipEnabled;
  overlayPositionInput.value  = prefs.overlayPosition;
  // Hide the PiP toggle row on non-Chromium browsers where the API is absent.
  if (!('documentPictureInPicture' in window)) {
    const pipField = pipEnabledInput.closest('.field') as HTMLElement | null;
    if (pipField !== null) pipField.hidden = true;
  }
  // Legacy installs may not have this field yet — show an empty textarea
  // rather than the word "undefined".
  const denylist = prefs.overlayDenylistedHosts ?? [];
  denylistInput.value = denylist.join('\n');
}

denylistSaveBtn.addEventListener('click', () => {
  void (async () => {
    const lines = denylistInput.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const prefs = await getStorage('preferences');
    await setStorage('preferences', { ...prefs, overlayDenylistedHosts: lines });
    setStatus(denylistStatus, t.optionsOverlayDenylistSaved, 'success');
  })();
});

// The floating-widget controls write through immediately on change so the
// effect is visible without a Save click.
overlayEnabledInput.addEventListener('change', () => {
  void (async () => {
    const prefs = await getStorage('preferences');
    await setStorage('preferences', { ...prefs, overlayEnabled: overlayEnabledInput.checked });
  })();
});

pipEnabledInput.addEventListener('change', () => {
  void (async () => {
    const prefs = await getStorage('preferences');
    await setStorage('preferences', { ...prefs, pipEnabled: pipEnabledInput.checked });
  })();
});

overlayPositionInput.addEventListener('change', () => {
  void (async () => {
    const prefs = await getStorage('preferences');
    const pos = overlayPositionInput.value as OverlayPosition;
    // Changing the preset corner also clears any custom-dragged position so
    // the new corner actually takes effect.
    await setStorage('preferences', { ...prefs, overlayPosition: pos, overlayCustomPos: null });
  })();
});

overlayResetBtn.addEventListener('click', () => {
  void (async () => {
    const prefs = await getStorage('preferences');
    await setStorage('preferences', { ...prefs, overlayCustomPos: null });
  })();
});

async function handlePrefsSubmit(event: Event): Promise<void> {
  event.preventDefault();

  const break1    = parseFloat(break1Input.value);
  const break2    = parseFloat(break2Input.value);
  const lang: Preferences['language'] = langSelect.value === 'en' ? 'en' : 'de';

  if (!Number.isFinite(break1) || break1 < 0.1 || break1 > 12) {
    setStatus(prefsStatus, t.optionsBreakRange, 'error');
    return;
  }
  if (!Number.isFinite(break2) || break2 < break1 || break2 > 12) {
    setStatus(prefsStatus, t.optionsBreakOrder, 'error');
    return;
  }

  const prevPrefs = await getStorage('preferences');
  const next: Preferences = {
    ...prevPrefs,
    breakReminder1Hours: break1,
    breakReminder2Hours: break2,
    language: lang,
  };
  await setStorage('preferences', next);

  // Reload bundle so a language change applies immediately.
  t = await loadMessages();
  applyI18n();
  setStatus(prefsStatus, t.optionsPrefsSaved, 'success');
}

// ── initial load ────────────────────────────────────────────────────────────

async function loadExistingConfig(): Promise<void> {
  const creds = await getStorage('credentials');
  if (creds !== null) showConnected('', creds.userId);
}

formCreds.addEventListener('submit', (e) => void handleSubmit(e));
hawkIdInput.addEventListener('input', () => updateCharCount(hawkIdInput, hawkIdCount));
hawkKeyInput.addEventListener('input', () => updateCharCount(hawkKeyInput, hawkKeyCount));
btnDisconnect.addEventListener('click', () => void handleDisconnect());

formPrefs.addEventListener('submit', (e) => void handlePrefsSubmit(e));

(async () => {
  t = await loadMessages();
  applyI18n();
  await Promise.all([loadExistingConfig(), loadPreferences()]);
  // Re-apply char counts after t is ready.
  updateCharCount(hawkIdInput, hawkIdCount);
  updateCharCount(hawkKeyInput, hawkKeyCount);
})();
