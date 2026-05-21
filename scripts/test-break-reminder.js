// Pulse — break-reminder test helper.
//
// Paste the snippet below into the SERVICE WORKER console of the loaded
// extension (chrome://extensions → Pulse → "Inspect views: service worker").
//
// What it does (no waiting 5 hours):
//   1. Reads current preferences.
//   2. Drops breakReminder1Hours / breakReminder2Hours to a few minutes
//      (default: 0.05 h = 3 min, 0.1 h = 6 min). Change MINUTES_1/2 below.
//   3. Clears the breakReminder*Fired flags so the next poll re-evaluates.
//   4. Forces an immediate poll. If you're clocked in long enough to clear
//      the new (tiny) thresholds, the OS notification fires within seconds.
//   5. Restores the original 5 / 5.5 thresholds when you call __restoreBreak().
//
// Optional smoke test: __fireBreak('first') or __fireBreak('final') fires the
// notification directly, bypassing the threshold math entirely.

(async () => {
  const MINUTES_1 = 3;     // first ("gentle") reminder threshold, in minutes
  const MINUTES_2 = 6;     // final ("sticky") reminder threshold, in minutes

  const { preferences: prev } = await chrome.storage.local.get('preferences');
  if (!prev) { console.error('No preferences in storage. Open the options page once.'); return; }

  globalThis.__originalBreakPrefs = {
    breakReminder1Hours: prev.breakReminder1Hours,
    breakReminder2Hours: prev.breakReminder2Hours,
  };

  const next = {
    ...prev,
    breakReminder1Hours: MINUTES_1 / 60,
    breakReminder2Hours: MINUTES_2 / 60,
  };
  await chrome.storage.local.set({ preferences: next });

  const { todayState } = await chrome.storage.local.get('todayState');
  await chrome.storage.local.set({
    todayState: {
      ...todayState,
      breakReminder1Fired: false,
      breakReminder2Fired: false,
      lastBreakEndMs: 0,
    },
  });

  console.log('[Pulse test] Thresholds dropped to', MINUTES_1, '/', MINUTES_2, 'min.');
  console.log('[Pulse test] Saved original:', globalThis.__originalBreakPrefs);
  console.log('[Pulse test] Make sure you are CLOCKED IN. Then wait', MINUTES_1, 'min.');
  console.log('[Pulse test] To restore: __restoreBreak()');
  console.log('[Pulse test] To fire directly without waiting: __fireBreak("first") or __fireBreak("final")');

  // Wake the service worker so it re-evaluates on the next poll tick.
  chrome.alarms.get('nh-poll', (a) => {
    if (a) chrome.alarms.create('nh-poll', { periodInMinutes: 1, when: Date.now() + 500 });
  });
})();

globalThis.__restoreBreak = async () => {
  if (!globalThis.__originalBreakPrefs) { console.warn('Nothing to restore.'); return; }
  const { preferences } = await chrome.storage.local.get('preferences');
  await chrome.storage.local.set({
    preferences: { ...preferences, ...globalThis.__originalBreakPrefs },
  });
  console.log('[Pulse test] Restored:', globalThis.__originalBreakPrefs);
  delete globalThis.__originalBreakPrefs;
};

globalThis.__fireBreak = (stage = 'first') => {
  const hours = stage === 'final' ? 5.5 : 5;
  chrome.notifications.create('nh-break-reminder', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/icons/icon-128.png'),
    title: 'Zeit für eine Pause',
    message: stage === 'final'
      ? 'Die gesetzliche 6-Stunden-Grenze ist nah — bitte jetzt eine Pause machen (ArbZG §4).'
      : `Du arbeitest seit ${hours} Std am Stück. Spätestens nach 6 Std ist eine 30-min Pause Pflicht.`,
    buttons: [{ title: 'Verstanden' }],
    priority: stage === 'final' ? 2 : 1,
    requireInteraction: stage === 'final',
  });
};
