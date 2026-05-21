// absence.io API shapes (only fields the extension reads)

export interface AbsenceUser {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  canManageTimetracking: boolean;
  canManageFutureTimespans: boolean;
  canManageTimetrackingEntries: boolean;
  canSeeTimetracking: boolean;
  canUseTimetracking: boolean;
  hideTimetracking: boolean;
}

export interface AbsenceUsersResponse {
  skip: number;
  limit: number;
  count: number;
  totalCount: number;
  data: AbsenceUser[];
}

export interface Timespan {
  _id: string;
  userId: string;
  start: string;   // ISO 8601 UTC
  end?: string;    // absent if still open
  type: 'work' | 'break';
}

export interface TimespansResponse {
  skip: number;
  limit: number;
  count: number;
  data: Timespan[];
}

export interface NewTimespan {
  userId: string;
  start: string;             // ISO 8601 UTC
  type: 'work' | 'break';
  end?: string;
}

// Extension state machine

export type WorkState = 'UNCONFIGURED' | 'IDLE' | 'WORKING' | 'WARNED' | 'SNOOZED';

// chrome.storage.local schema

export interface Credentials {
  hawkId: string;
  hawkKey: string;
  userId: string;
}

export interface TodayState {
  isClockedIn: boolean;
  currentTimespanId: string | null;
  stampInTimestamp: number | null;   // epoch ms UTC
  elapsedMsToday: number;            // ms; sum of all closed work timespans + current open one
  lastSyncedAt: number;              // epoch ms UTC
  breakReminder1Fired: boolean;      // ArbZG §4 — fired at threshold 1 since last break
  breakReminder2Fired: boolean;      // fired at threshold 2 since last break
  lastBreakEndMs: number;            // 0 if no break yet today; used to reset reminder flags
}

export interface Permissions {
  canManageTimetrackingEntries: boolean;
  canManageFutureTimespans: boolean;
  canSeeTimetracking: boolean;
  canUseTimetracking: boolean;
}

export type OverlayPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type OverlayShape = 'circle' | 'square';

export interface OverlayCustomPos {
  x: number;   // viewport pixels from left
  y: number;   // viewport pixels from top
}

export interface Preferences {
  clockOutThresholdHours: number;      // default 8
  notificationSnoozeMinutes: number;   // default 30
  language: 'de' | 'en';               // default 'de' (Nature Heart is a German company)
  breakReminder1Hours: number;         // default 5    (first nudge)
  breakReminder2Hours: number;         // default 5.5  (final nudge before 6h ArbZG limit)
  overlayEnabled: boolean;             // default true — floating widget on every site
  overlayMinimized: boolean;           // default false — minimized = compact pill
  overlayPosition: OverlayPosition;    // default 'bottom-right' (used when no custom pos)
  overlayCustomPos: OverlayCustomPos | null;  // null = snap to corner from overlayPosition
  overlayShape: OverlayShape;          // default 'circle'
  // Picture-in-Picture floating window. When true, the in-page menu shows a
  // pop-out control that opens an always-on-top PiP window with a larger
  // pill. Requires Document Picture-in-Picture support (Chromium 116+).
  pipEnabled: boolean;                 // default false — opt-in
  // Hostname patterns where the overlay must not inject (banking, password
  // managers, identity providers). One pattern per array entry. Supported
  // forms: exact match (`accounts.google.com`), suffix wildcard
  // (`*.paypal.com`), or a generic glob (`*bank*`). Case-insensitive.
  overlayDenylistedHosts: string[];
}

export interface ExtensionStorage {
  credentials: Credentials | null;
  todayState: TodayState;
  workState: WorkState;
  permissions: Permissions | null;
  preferences: Preferences;
  consecutiveFailures: number;   // resets to 0 on success; drives poll backoff
  // Set to Date.now() right after a successful clock-in/clock-out triggered
  // from our extension. The absence.io content script watches this key and
  // reloads the page so absence.io's UI reflects the change immediately.
  lastStampActionAt: number;
}

// Messages between popup/content script and service worker

export type MessageType =
  | 'STAMP_IN'
  | 'STAMP_OUT'
  | 'GET_STATE'
  | 'SNOOZE_NOTIFICATION'
  | 'OPEN_OPTIONS'
  | 'RESET_OVERLAY_DISMISS';

export interface Message {
  type: MessageType;
}

export interface StateResponse {
  workState: WorkState;
  todayState: TodayState;
  userName?: string;
  error?: string;          // surfaced from stamp-in/out failure
}

export interface ApiError {
  status: number;
  message: string;
}
