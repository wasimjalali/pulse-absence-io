// Updates the toolbar badge text and color.
// Full implementation in step 6.

import { COLOR_GREEN, COLOR_AMBER, COLOR_RED, COLOR_WARN, BADGE_AMBER_THRESHOLD_HOURS } from '../shared/constants';

export function updateBadge(elapsedMs: number, isClockedIn: boolean): void {
  if (!isClockedIn) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  chrome.action.setBadgeText({ text: `${hours}:${String(minutes).padStart(2, '0')}` });

  let color = COLOR_GREEN;
  if (hours >= 8) color = COLOR_RED;
  else if (hours >= BADGE_AMBER_THRESHOLD_HOURS) color = COLOR_AMBER;

  chrome.action.setBadgeBackgroundColor({ color });
}

export function setBadgeError(): void {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: COLOR_WARN });
}

export function clearBadge(): void {
  chrome.action.setBadgeText({ text: '' });
}
