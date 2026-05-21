import type { ExtensionStorage, TodayState, WorkState, Preferences } from './types';

const DEFAULTS: Partial<ExtensionStorage> = {
  credentials: null,
  workState: 'UNCONFIGURED' satisfies WorkState,
  permissions: null,
  todayState: {
    isClockedIn: false,
    currentTimespanId: null,
    stampInTimestamp: null,
    elapsedMsToday: 0,
    lastSyncedAt: 0,
    breakReminder1Fired: false,
    breakReminder2Fired: false,
    lastBreakEndMs: 0,
  } satisfies TodayState,
  preferences: {
    clockOutThresholdHours: 8,
    notificationSnoozeMinutes: 30,
    language: 'de',
    breakReminder1Hours: 5,
    breakReminder2Hours: 5.5,
    overlayEnabled: true,
    overlayMinimized: false,
    overlayPosition: 'bottom-right',
    overlayCustomPos: null,
    overlayShape: 'circle',
    pipEnabled: false,
    // Conservative defaults: identity providers, password managers, and
    // common payment dashboards. Users can edit this list in the options.
    overlayDenylistedHosts: [
      'accounts.google.com',
      'login.microsoftonline.com',
      'login.live.com',
      '*.paypal.com',
      '*.1password.com',
      '*.bitwarden.com',
      '*.lastpass.com',
      '*.dashlane.com',
    ],
  } satisfies Preferences,
  consecutiveFailures: 0,
  lastStampActionAt: 0,
};

export async function getStorage<K extends keyof ExtensionStorage>(
  key: K,
): Promise<ExtensionStorage[K]> {
  const result = await chrome.storage.local.get(key as string);
  const value = (result as Record<string, unknown>)[key as string];
  if (value === undefined) {
    return (DEFAULTS[key] ?? null) as ExtensionStorage[K];
  }
  return value as ExtensionStorage[K];
}

export async function setStorage<K extends keyof ExtensionStorage>(
  key: K,
  value: ExtensionStorage[K],
): Promise<void> {
  await chrome.storage.local.set({ [key as string]: value });
}

// Atomic multi-key write. Useful at boundaries (e.g., the options page
// completing onboarding) where several keys must land in a single
// storage.onChanged event so listeners see consistent state.
export async function setStorageBatch(
  updates: Partial<ExtensionStorage>,
): Promise<void> {
  await chrome.storage.local.set(updates as Record<string, unknown>);
}

export async function clearCredentials(): Promise<void> {
  await chrome.storage.local.set({
    credentials: null,
    workState: 'UNCONFIGURED' satisfies WorkState,
    permissions: null,
  });
}

export async function resetTodayState(): Promise<void> {
  await setStorage('todayState', DEFAULTS.todayState as TodayState);
}
