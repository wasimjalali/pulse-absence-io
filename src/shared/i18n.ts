// Tiny i18n helper. No runtime deps, no chrome.i18n (which doesn't support
// preference-driven runtime switching well). Resolves the active language
// from preferences.language → browser UI language → 'en'.

import { getStorage } from './storage';

export type Lang = 'en' | 'de';

interface MessageBundle {
  // Popup
  setupPrompt: string;
  openSetup: string;
  notClockedIn: string;
  clockedIn: string;
  timeToLeave: string;
  snoozed: string;
  clockInBtn: string;
  clockOutBtn: string;
  clockingIn: string;
  clockingOut: string;
  clockedInOk: string;
  clockedOutOk: string;
  errorConnection: string;
  startedAt: string;
  projectedEnd: string;
  todayTotal: string;
  syncedJustNow: string;
  syncedMinutesAgo: (n: number) => string;
  syncedHoursAgo: (n: number) => string;
  loading: string;
  // Overlay
  overlayClockIn: string;
  overlayClockOut: string;
  overlayClockOutNow: string;
  overlayClockedInToast: string;
  overlayClockedOutToast: string;
  overlayCannotConnect: string;
  overlayMinimize: string;
  overlayExpand: string;
  overlayClose: string;
  overlayHiddenPillTitle: string;
  overlayShapeTooltip: string;
  overlayShapeCircle: string;
  overlayShapeSquare: string;
  overlayPopOut: string;
  overlayPopOutClose: string;
  overlayPipOpened: string;
  overlayPipUnsupported: string;
  // Notification
  notificationTitle: string;
  notificationBody: string;
  notificationClockOut: string;
  notificationSnooze: (m: number) => string;
  // Break reminder notification
  breakNotificationTitle: string;
  breakNotificationBodyFirst: (h: string) => string;
  breakNotificationBodyFinal: string;
  breakNotificationDismiss: string;
  // Break reminder modal (in-page, branded)
  breakModalEyebrowFirst: string;
  breakModalEyebrowFinal: string;
  breakModalContinuousLabel: string;
  breakModalLater: string;
  breakModalAck: string;
  // Options
  optionsTitle: string;
  optionsSubtitle: string;
  optionsConnectTitle: string;
  optionsConnectSubtitle: string;
  optionsInstructionsSummary: string;
  optionsInstructionStep1: string;
  optionsInstructionStep2: string;
  optionsInstructionStep3: string;
  optionsInstructionStep4: string;
  optionsInstructionStep5: string;
  optionsHawkIdLabel: string;
  optionsHawkIdHint: string;
  optionsHawkKeyLabel: string;
  optionsHawkKeyHint: string;
  optionsVerifyBtn: string;
  optionsVerifying: string;
  optionsCharCountSuffix: string;
  optionsConnectedPill: string;
  optionsUserIdLabel: string;
  optionsConnected: (name: string) => string;
  optionsConnectedReady: (name: string) => string;
  optionsConnecting: string;
  optionsDisconnect: string;
  optionsDisconnected: string;
  optionsBothFieldsRequired: string;
  optionsKeyLengthWarn: (n: number) => string;
  optionsNoPermission: string;
  optionsError401: string;
  optionsError403: string;
  optionsErrorNetwork: string;
  optionsErrorOther: (status: number) => string;
  optionsErrorUnexpected: string;
  optionsOverlayTitle: string;
  optionsOverlayEnable: string;
  optionsOverlayEnableHint: string;
  optionsPipTitle: string;
  optionsPipEnable: string;
  optionsPipEnableHint: string;
  popupPipToggle: string;
  optionsOverlayPosition: string;
  optionsOverlayDenylistLabel: string;
  optionsOverlayDenylistHint: string;
  optionsOverlayDenylistSaved: string;
  optionsPosBottomRight: string;
  optionsPosBottomLeft: string;
  optionsPosTopRight: string;
  optionsPosTopLeft: string;
  optionsResetPosition: string;
  optionsResetPositionHint: string;
  optionsPreferences: string;
  optionsGeneralTitle: string;
  optionsLanguage: string;
  optionsLanguageEn: string;
  optionsLanguageDe: string;
  optionsHoursSuffix: string;
  optionsBreak1: string;
  optionsBreak2: string;
  optionsBreakHint: string;
  optionsBreakRange: string;
  optionsBreakOrder: string;
  optionsSavePrefs: string;
  optionsPrefsSaved: string;
}

const en: MessageBundle = {
  setupPrompt: 'Set up your absence.io credentials to get started.',
  openSetup: 'Open setup page',
  notClockedIn: 'Not clocked in',
  clockedIn: 'Clocked in',
  timeToLeave: 'Time to clock out',
  snoozed: 'Snoozed',
  clockInBtn: 'Clock in',
  clockOutBtn: 'Clock out',
  clockingIn: 'Clocking in…',
  clockingOut: 'Clocking out…',
  clockedInOk: 'Clocked in.',
  clockedOutOk: 'Clocked out.',
  errorConnection: 'Could not connect. Try again.',
  startedAt: 'Started',
  projectedEnd: 'End by',
  todayTotal: 'Today',
  syncedJustNow: 'Synced just now',
  syncedMinutesAgo: (n) => `Synced ${n} min ago`,
  syncedHoursAgo: (n) => `Synced ${n}h ago`,
  loading: 'Loading…',
  overlayClockIn: 'Clock in',
  overlayClockOut: 'Clock out',
  overlayClockOutNow: 'Clock out now',
  overlayClockedInToast: 'Clocked in',
  overlayClockedOutToast: 'Clocked out',
  overlayCannotConnect: 'Could not connect',
  overlayMinimize: 'Minimise',
  overlayExpand: 'Expand',
  overlayClose: 'Hide overlay',
  overlayHiddenPillTitle: 'Open Pulse',
  overlayShapeTooltip: 'Shape',
  overlayShapeCircle: 'Circle',
  overlayShapeSquare: 'Square',
  overlayPopOut: 'Pop out',
  overlayPopOutClose: 'Close floating window',
  overlayPipOpened: 'Floating window opened',
  overlayPipUnsupported: 'Floating window is not supported in this browser',
  notificationTitle: 'Time to clock out',
  notificationBody: "You've been clocked in for over 8 hours.",
  notificationClockOut: 'Clock out now',
  notificationSnooze: (m) => `Snooze ${m} min`,
  breakNotificationTitle: 'Time for a break',
  breakNotificationBodyFirst: (h) => `You've been working ${h}h straight. A 30-minute break is legally required at 6 hours.`,
  breakNotificationBodyFinal: 'The 6-hour limit is close. Please take a break now (German ArbZG §4).',
  breakNotificationDismiss: 'Got it',
  breakModalEyebrowFirst: 'Break reminder',
  breakModalEyebrowFinal: 'Break now',
  breakModalContinuousLabel: 'Worked continuously: ',
  breakModalLater: 'Later',
  breakModalAck: 'I’ll take a break',
  optionsTitle: 'Pulse',
  optionsSubtitle: 'Time, in rhythm with your work, for absence.io',
  optionsConnectTitle: 'Connect your account',
  optionsConnectSubtitle: 'Generate an API key in absence.io and paste both values below.',
  optionsInstructionsSummary: 'How to generate an API key',
  optionsInstructionStep1: 'Sign in to app.absence.io',
  optionsInstructionStep2: 'Click your avatar in the top-right corner',
  optionsInstructionStep3: 'Open User Settings → Integrations',
  optionsInstructionStep4: 'Click Generate API Key (Regenerate invalidates the previous key)',
  optionsInstructionStep5: 'Copy each value and paste it into the matching field below',
  optionsHawkIdLabel: 'Key Identifier',
  optionsHawkIdHint: '24-character hex string',
  optionsHawkKeyLabel: 'Key',
  optionsHawkKeyHint: 'secret value',
  optionsVerifyBtn: 'Verify and save',
  optionsVerifying: 'Verifying…',
  optionsCharCountSuffix: 'chars',
  optionsConnectedPill: 'Connected',
  optionsUserIdLabel: 'user ID',
  optionsConnected: (name) => name ? `Connected as ${name}` : 'Connected',
  optionsConnectedReady: (name) => `Connected as ${name}. Extension is ready.`,
  optionsConnecting: 'Connecting to absence.io…',
  optionsDisconnect: 'Disconnect',
  optionsDisconnected: 'Disconnected. Paste your credentials above to reconnect.',
  optionsBothFieldsRequired: 'Both fields are required.',
  optionsKeyLengthWarn: (n) => `Key Identifier must be 24 characters. Yours is ${n}. Check for extra whitespace or a partial paste.`,
  optionsNoPermission: 'Your account does not have permission to manage time entries. Contact your admin.',
  optionsError401: 'The credentials are not accepted. Re-check the values, especially for hidden whitespace from copy-paste.',
  optionsError403: 'Access denied (403). Your account may not have API access enabled. Contact your admin.',
  optionsErrorNetwork: 'Could not reach absence.io. Check your internet connection and try again.',
  optionsErrorOther: (status) => `Unexpected error (HTTP ${status}). Try again.`,
  optionsErrorUnexpected: 'Unexpected error. Try again.',
  optionsOverlayTitle: 'Floating widget',
  optionsOverlayEnable: 'Show floating widget while clocked in',
  optionsOverlayEnableHint: 'Adds a small pill that shows your current state and elapsed work time on any web page. Hidden when you are clocked out.',
  optionsPipTitle: 'Floating window (always on top)',
  optionsPipEnable: 'Allow a pop-out window that stays on top of all tabs',
  optionsPipEnableHint: 'Adds a "Pop out" button to the floating widget. Once opened, a small window with your elapsed time floats above every tab and stays visible when you switch sites or minimise the browser. Open it once per browser session from any web page. Closes when you close the browser.',
  popupPipToggle: 'Pop-out floating window',
  optionsOverlayPosition: 'Position',
  optionsOverlayDenylistLabel: 'Hide the widget on these sites',
  optionsOverlayDenylistHint: 'One pattern per line. Use exact hostnames (accounts.google.com), subdomain wildcards (*.paypal.com) or glob patterns (*bank*). Lines starting with # are comments.',
  optionsOverlayDenylistSaved: 'Site list saved.',
  optionsPosBottomRight: 'Bottom right',
  optionsPosBottomLeft: 'Bottom left',
  optionsPosTopRight: 'Top right',
  optionsPosTopLeft: 'Top left',
  optionsResetPosition: 'Reset position',
  optionsResetPositionHint: 'You can also drag the widget anywhere on screen. Reset snaps it back to the corner above.',
  optionsPreferences: 'Settings',
  optionsGeneralTitle: 'General',
  optionsLanguage: 'Language',
  optionsLanguageEn: 'English',
  optionsLanguageDe: 'Deutsch',
  optionsHoursSuffix: 'hours',
  optionsBreak1: 'First break reminder after',
  optionsBreak2: 'Final break reminder after',
  optionsBreakHint: 'German ArbZG §4 requires a 30-min break after 6 hours of work. Defaults: 5.0 h and 5.5 h.',
  optionsBreakRange: 'Break reminders must be between 0.1 and 12 hours.',
  optionsBreakOrder: 'The final reminder must come after the first one (and not above 12 hours).',
  optionsSavePrefs: 'Save preferences',
  optionsPrefsSaved: 'Preferences saved.',
};

const de: MessageBundle = {
  setupPrompt: 'Bitte hinterlege deine absence.io-Zugangsdaten.',
  openSetup: 'Einrichtung öffnen',
  notClockedIn: 'Nicht eingestempelt',
  clockedIn: 'Eingestempelt',
  timeToLeave: 'Zeit zum Ausstempeln',
  snoozed: 'Erinnerung pausiert',
  clockInBtn: 'Einstempeln',
  clockOutBtn: 'Ausstempeln',
  clockingIn: 'Stemple ein…',
  clockingOut: 'Stemple aus…',
  clockedInOk: 'Eingestempelt.',
  clockedOutOk: 'Ausgestempelt.',
  errorConnection: 'Verbindung fehlgeschlagen. Bitte erneut versuchen.',
  startedAt: 'Beginn',
  projectedEnd: 'Bis',
  todayTotal: 'Heute',
  syncedJustNow: 'Gerade synchronisiert',
  syncedMinutesAgo: (n) => `Vor ${n} Min synchronisiert`,
  syncedHoursAgo: (n) => `Vor ${n} Std synchronisiert`,
  loading: 'Lädt…',
  overlayClockIn: 'Einstempeln',
  overlayClockOut: 'Ausstempeln',
  overlayClockOutNow: 'Jetzt ausstempeln',
  overlayClockedInToast: 'Eingestempelt',
  overlayClockedOutToast: 'Ausgestempelt',
  overlayCannotConnect: 'Verbindung fehlgeschlagen',
  overlayMinimize: 'Minimieren',
  overlayExpand: 'Vergrößern',
  overlayClose: 'Anzeige ausblenden',
  overlayHiddenPillTitle: 'Pulse öffnen',
  overlayShapeTooltip: 'Form',
  overlayShapeCircle: 'Kreis',
  overlayShapeSquare: 'Quadrat',
  overlayPopOut: 'Ausklappen',
  overlayPopOutClose: 'Schwebendes Fenster schließen',
  overlayPipOpened: 'Schwebendes Fenster geöffnet',
  overlayPipUnsupported: 'Schwebendes Fenster wird in diesem Browser nicht unterstützt',
  notificationTitle: 'Zeit zum Ausstempeln',
  notificationBody: 'Du bist seit über 8 Stunden eingestempelt.',
  notificationClockOut: 'Jetzt ausstempeln',
  notificationSnooze: (m) => `${m} Min schlummern`,
  breakNotificationTitle: 'Zeit für eine Pause',
  breakNotificationBodyFirst: (h) => `Du arbeitest seit ${h} Std am Stück. Spätestens nach 6 Std ist eine 30-min Pause Pflicht.`,
  breakNotificationBodyFinal: 'Die gesetzliche 6-Stunden-Grenze ist nah. Bitte jetzt eine Pause machen (ArbZG §4).',
  breakNotificationDismiss: 'Verstanden',
  breakModalEyebrowFirst: 'Pausenerinnerung',
  breakModalEyebrowFinal: 'Pause jetzt',
  breakModalContinuousLabel: 'Am Stück gearbeitet: ',
  breakModalLater: 'Später',
  breakModalAck: 'Pause machen',
  optionsTitle: 'Pulse',
  optionsSubtitle: 'Im Rhythmus deines Arbeitstags, für absence.io',
  optionsConnectTitle: 'Konto verbinden',
  optionsConnectSubtitle: 'Erstelle einen API-Schlüssel in absence.io und füge beide Werte unten ein.',
  optionsInstructionsSummary: 'API-Schlüssel erstellen: so geht’s',
  optionsInstructionStep1: 'Bei app.absence.io anmelden',
  optionsInstructionStep2: 'Oben rechts auf dein Profilbild klicken',
  optionsInstructionStep3: 'Benutzereinstellungen → Integrationen öffnen',
  optionsInstructionStep4: 'API-Schlüssel generieren klicken (Neu generieren macht den alten Schlüssel ungültig)',
  optionsInstructionStep5: 'Beide Werte kopieren und in die passenden Felder einfügen',
  optionsHawkIdLabel: 'Schlüssel-Kennung',
  optionsHawkIdHint: '24-stellige Hex-Zeichenfolge',
  optionsHawkKeyLabel: 'Schlüssel',
  optionsHawkKeyHint: 'geheimer Wert',
  optionsVerifyBtn: 'Prüfen und speichern',
  optionsVerifying: 'Wird geprüft…',
  optionsCharCountSuffix: 'Zeichen',
  optionsConnectedPill: 'Verbunden',
  optionsUserIdLabel: 'Benutzer-ID',
  optionsConnected: (name) => name ? `Verbunden als ${name}` : 'Verbunden',
  optionsConnectedReady: (name) => `Verbunden als ${name}. Die Erweiterung ist bereit.`,
  optionsConnecting: 'Verbinde mit absence.io…',
  optionsDisconnect: 'Trennen',
  optionsDisconnected: 'Verbindung getrennt. Zum Wiederverbinden Zugangsdaten oben einfügen.',
  optionsBothFieldsRequired: 'Beide Felder sind erforderlich.',
  optionsKeyLengthWarn: (n) => `Die Schlüssel-Kennung muss 24 Zeichen lang sein. Deine hat ${n}. Bitte auf Leerzeichen oder unvollständige Einfügung prüfen.`,
  optionsNoPermission: 'Dein Konto hat keine Berechtigung, Zeiteinträge zu verwalten. Bitte wende dich an deinen Admin.',
  optionsError401: 'Die Zugangsdaten wurden nicht akzeptiert. Bitte Werte erneut prüfen, vor allem auf versteckte Leerzeichen.',
  optionsError403: 'Zugriff verweigert (403). Dein Konto hat möglicherweise keinen API-Zugang. Bitte Admin kontaktieren.',
  optionsErrorNetwork: 'Verbindung zu absence.io fehlgeschlagen. Bitte Internetverbindung prüfen und erneut versuchen.',
  optionsErrorOther: (status) => `Unerwarteter Fehler (HTTP ${status}). Bitte erneut versuchen.`,
  optionsErrorUnexpected: 'Unerwarteter Fehler. Bitte erneut versuchen.',
  optionsOverlayTitle: 'Schwebende Anzeige',
  optionsOverlayEnable: 'Anzeige einblenden, wenn eingestempelt',
  optionsOverlayEnableHint: 'Zeigt eine kleine Pille mit Status und Arbeitszeit auf jeder geöffneten Webseite an. Bei ausgestempeltem Zustand ist sie ausgeblendet.',
  optionsPipTitle: 'Schwebendes Fenster (immer im Vordergrund)',
  optionsPipEnable: 'Ausklappbares Fenster erlauben, das über allen Tabs bleibt',
  optionsPipEnableHint: 'Fügt der schwebenden Anzeige eine „Ausklappen“-Schaltfläche hinzu. Einmal geöffnet, bleibt ein kleines Fenster mit deiner Arbeitszeit immer im Vordergrund, auch beim Wechseln der Webseite oder Minimieren des Browsers. Einmal pro Browser-Sitzung von einer beliebigen Webseite aus öffnen. Schließt sich beim Beenden des Browsers.',
  popupPipToggle: 'Ausklappbares schwebendes Fenster',
  optionsOverlayPosition: 'Position',
  optionsOverlayDenylistLabel: 'Anzeige auf diesen Seiten ausblenden',
  optionsOverlayDenylistHint: 'Ein Muster pro Zeile. Exakte Hostnamen (accounts.google.com), Subdomain-Platzhalter (*.paypal.com) oder Glob-Muster (*bank*). Zeilen mit # sind Kommentare.',
  optionsOverlayDenylistSaved: 'Liste gespeichert.',
  optionsPosBottomRight: 'Unten rechts',
  optionsPosBottomLeft: 'Unten links',
  optionsPosTopRight: 'Oben rechts',
  optionsPosTopLeft: 'Oben links',
  optionsResetPosition: 'Position zurücksetzen',
  optionsResetPositionHint: 'Du kannst die Anzeige auch frei mit der Maus verschieben. „Zurücksetzen“ rastet sie wieder in die oben gewählte Ecke ein.',
  optionsPreferences: 'Einstellungen',
  optionsGeneralTitle: 'Allgemein',
  optionsLanguage: 'Sprache',
  optionsLanguageEn: 'English',
  optionsLanguageDe: 'Deutsch',
  optionsHoursSuffix: 'Stunden',
  optionsBreak1: 'Erste Pausenerinnerung nach',
  optionsBreak2: 'Letzte Pausenerinnerung nach',
  optionsBreakHint: 'Nach ArbZG §4 ist nach 6 Std eine 30-min Pause Pflicht. Standard: 5,0 und 5,5 Stunden.',
  optionsBreakRange: 'Pausenerinnerungen müssen zwischen 0,1 und 12 Stunden liegen.',
  optionsBreakOrder: 'Die letzte Erinnerung muss nach der ersten liegen (und max. 12 Stunden).',
  optionsSavePrefs: 'Einstellungen speichern',
  optionsPrefsSaved: 'Einstellungen gespeichert.',
};

const bundles: Record<Lang, MessageBundle> = { en, de };

export async function loadMessages(): Promise<MessageBundle> {
  const prefs = await getStorage('preferences');
  // German is the default. Older installs without a language preference fall
  // back to 'de' too — the company is German, so it's the right default.
  const lang: Lang = prefs.language === 'en' ? 'en' : 'de';
  return bundles[lang];
}

// Synchronous variant for service-worker contexts where we already know the lang.
export function messagesFor(lang: Lang): MessageBundle {
  return bundles[lang];
}
