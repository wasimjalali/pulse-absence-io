// Content script — floating widget on every http(s) page.
// Closed Shadow DOM. The pill is the visual indicator (state colour + time).
// Hover or click reveals a single floating menu containing the action button
// (clock in / out) and three controls (shape, minimise, close). The menu is
// position:fixed and placed by JS so it always lands inside the viewport,
// regardless of where the user has dragged the pill.

import type { Message, StateResponse, WorkState, TodayState, OverlayPosition, OverlayCustomPos, OverlayShape } from '../shared/types';
import { loadMessages } from '../shared/i18n';
import { getStorage, setStorage } from '../shared/storage';
import { hostMatches } from '../shared/host-match';

(function bootstrap() {
  // Site denylist (banking, password managers, identity providers). The
  // floating pill silently stays hidden on these hosts so it never paints
  // over login or payment screens. Patterns are user-editable in the options.
  // The break-reminder modal IS still allowed on denylisted hosts — it's a
  // system-level reminder, not the persistent overlay, and only appears
  // briefly when a break threshold is crossed.
  function tryInit(denyListedHost: boolean): void {
    if (document.getElementById('nh-companion-root')) return;
    if (!document.body) return;
    initOverlay(denyListedHost);
  }

  void (async () => {
    const prefs = await getStorage('preferences');
    const denylist = prefs.overlayDenylistedHosts ?? [];
    const denyListedHost = hostMatches(location.hostname, denylist);

    // Body may not be ready at document_idle for some single-page apps that
    // mount late or replace <body>. Watch documentElement's direct children
    // (NOT subtree) so we fire once when <body> appears and not on every
    // descendant mutation.
    if (!document.body) {
      const bodyWaiter = new MutationObserver(() => {
        if (document.body) {
          bodyWaiter.disconnect();
          tryInit(denyListedHost);
        }
      });
      bodyWaiter.observe(document.documentElement, { childList: true });
    } else {
      tryInit(denyListedHost);
    }
  })();
})();

function initOverlay(denyListedHost = false): void {
  if (document.getElementById('nh-companion-root')) return;
  if (!document.body) return;

  // ── Host ────────────────────────────────────────────────────────────────────
  const host = document.createElement('div');
  host.id = 'nh-companion-root';
  // CRITICAL: do NOT force `display` here. The host needs to honour the
  // `hidden` attribute so the close button can actually hide the widget.
  // Forcing `display: block !important` previously made `host.hidden = true`
  // a no-op (UA stylesheet's `[hidden]{display:none}` lost the cascade) which
  // left a stranded pill on screen after Close. The :host([hidden]) rule in
  // the shadow stylesheet below is the belt-and-braces guard.
  host.style.cssText = [
    'position: fixed !important',
    'top: 0 !important',
    'left: 0 !important',
    'width: 0 !important',
    'height: 0 !important',
    'margin: 0 !important',
    'padding: 0 !important',
    'border: 0 !important',
    'overflow: visible !important',
    'z-index: 2147483647 !important',
    'pointer-events: none !important',
    'opacity: 1 !important',
    'transform: none !important',
    'clip: auto !important',
    'clip-path: none !important',
    'color-scheme: light',
  ].join('; ') + ';';
  const shadow = host.attachShadow({ mode: 'closed' });

  // ── Styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    :host([hidden]) { display: none !important; }

    .root.is-hidden { display: none !important; }

    .root {
      position: fixed;
      z-index: 2147483647;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      pointer-events: none;
    }
    .root.pos-bottom-right { bottom: 22px; right: 22px; }
    .root.pos-bottom-left  { bottom: 22px; left:  22px; }
    .root.pos-top-right    { top:    22px; right: 22px; }
    .root.pos-top-left     { top:    22px; left:  22px; }

    .toast {
      position: absolute;
      bottom: calc(100% + 10px);
      right: 0;
      background: #15171a;
      color: #fdfcfa;
      font-size: 12px;
      font-weight: 500;
      padding: 8px 14px;
      border-radius: 8px;
      letter-spacing: 0.01em;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      max-width: 260px;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(21,23,26,0.20), 0 12px 32px rgba(21,23,26,0.18);
    }
    .toast.visible { opacity: 1; transform: translateY(0); }
    .toast.error { background: #8b291b; }

    /* ── Pill (visual indicator) ──────────────────────────────────────────── */

    .pill {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 8px 14px;
      background: #ffffff;
      color: #15171a;
      border: 1px solid #e5e3da;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      letter-spacing: 0.01em;
      cursor: grab;
      pointer-events: auto;
      box-shadow:
        0 1px 2px rgba(21,23,26,0.06),
        0 8px 24px -8px rgba(21,23,26,0.18);
      transition:
        transform 0.12s cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1),
        background 0.18s ease,
        border-color 0.18s ease;
      user-select: none;
      white-space: nowrap;
      touch-action: none;
    }
    .pill:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(21,23,26,0.08), 0 12px 28px -8px rgba(21,23,26,0.22);
    }
    .pill:focus-visible {
      outline: 2px solid #0E7C6B;
      outline-offset: 3px;
    }
    .pill.dragging { cursor: grabbing; transition: none; }

    .pill[data-state="WORKING"] { background: linear-gradient(180deg, #effaf6 0%, #ddf2e9 100%); border-color: #b8e0d2; color: #0B4F44; }
    .pill[data-state="WARNED"]  { background: linear-gradient(180deg, #fdf4e6 0%, #fbeede 100%); border-color: #f1d5b4; color: #823e09; }
    .pill[data-state="SNOOZED"] { background: linear-gradient(180deg, #faf3dc 0%, #f5edd2 100%); border-color: #e0d5b0; color: #5e4d11; }
    .pill[data-state="IDLE"]    { background: #ffffff; border-color: #e5e3da; color: #525751; }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #8e9089;
      box-shadow: 0 0 0 3px rgba(142, 144, 137, 0.18);
    }
    .pill[data-state="WORKING"] .dot { background: #0F8674; box-shadow: 0 0 0 3px rgba(15, 134, 116, 0.22); }
    .pill[data-state="WARNED"]  .dot { background: #C97A1A; box-shadow: 0 0 0 3px rgba(201, 122, 26, 0.22); animation: pulse 1.8s ease-in-out infinite; }
    .pill[data-state="SNOOZED"] .dot { background: #846b1a; box-shadow: 0 0 0 3px rgba(132, 107, 26, 0.20); }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 3px rgba(201, 122, 26, 0.22), 0 0 0 0 rgba(201, 122, 26, 0.45); }
      50%      { box-shadow: 0 0 0 3px rgba(201, 122, 26, 0.22), 0 0 0 8px rgba(201, 122, 26, 0); }
    }

    /* Time is the focal element in every shape — bigger, bolder than label. */
    .time {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .label {
      font-size: 11px;
      font-weight: 500;
      opacity: 0.7;
      letter-spacing: 0.01em;
    }

    /* ── Compact (minimised) and shape variants ──────────────────────────── */

    .pill.compact { padding: 6px 11px; }
    .pill.compact .label { display: none; }

    .pill.shape-circle,
    .pill.shape-square {
      flex-direction: column;
      gap: 0;
      padding: 0;
      width: 72px;
      height: 72px;
      justify-content: center;
      align-items: center;
    }
    .pill.shape-circle { border-radius: 50%; }
    .pill.shape-square { border-radius: 18px; }
    .pill.shape-circle .label,
    .pill.shape-square .label,
    .pill.shape-circle .dot,
    .pill.shape-square .dot { display: none; }
    .pill.shape-circle .time,
    .pill.shape-square .time {
      font-size: 22px;
      letter-spacing: -0.03em;
    }

    .pill.hidden-launcher {
      width: 36px; height: 36px; padding: 0;
      justify-content: center;
      border-radius: 50%;
    }
    .pill.hidden-launcher .label,
    .pill.hidden-launcher .time,
    .pill.hidden-launcher .dot { display: none; }
    .pill.hidden-launcher .launcher-icon { display: inline-flex; }
    .launcher-icon { display: none; color: #0E7C6B; }

    /* ── Floating menu (action button + controls) ────────────────────────── */

    .menu {
      position: fixed;
      top: 0;
      left: 0;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px;
      background: #ffffff;
      border: 1px solid #e5e3da;
      border-radius: 12px;
      box-shadow:
        0 2px 6px rgba(21,23,26,0.06),
        0 16px 40px -8px rgba(21,23,26,0.24);
      opacity: 0;
      pointer-events: none;
      transform: scale(0.96);
      transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1),
                  transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: inherit;
    }
    .menu.visible {
      opacity: 1;
      pointer-events: auto;
      transform: scale(1);
    }

    .menu-action {
      padding: 9px 14px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      letter-spacing: 0.01em;
      cursor: pointer;
      color: #fdfcfa;
      transition: background 0.15s ease, opacity 0.15s ease, transform 0.08s ease;
      white-space: nowrap;
    }
    .menu-action:active:not(:disabled) { transform: translateY(1px); }
    .menu-action:disabled { opacity: 0.55; cursor: not-allowed; }
    .menu-action:focus-visible {
      outline: 2px solid #0E7C6B;
      outline-offset: 2px;
    }
    .menu-action.action-in {
      background: linear-gradient(135deg, #0E7C6B 0%, #14A38B 100%);
      box-shadow: 0 1px 2px rgba(14, 124, 107, 0.30), 0 1px 0 rgba(255,255,255,0.18) inset;
    }
    .menu-action.action-out {
      background: linear-gradient(135deg, #C24E3A 0%, #E26A56 100%);
      box-shadow: 0 1px 2px rgba(194, 78, 58, 0.32), 0 1px 0 rgba(255,255,255,0.18) inset;
    }
    .menu-action.action-warn {
      background: linear-gradient(135deg, #C97A1A 0%, #E09430 100%);
      box-shadow: 0 1px 2px rgba(201, 122, 26, 0.30), 0 1px 0 rgba(255,255,255,0.18) inset;
    }

    .menu-sep {
      width: 1px;
      height: 22px;
      background: rgba(21,23,26,0.10);
      flex-shrink: 0;
    }

    .menu-controls {
      display: inline-flex;
      gap: 2px;
      align-items: center;
    }

    .ctrl {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      background: transparent;
      color: rgba(21,23,26,0.55);
      cursor: pointer;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .ctrl:hover { background: rgba(21,23,26,0.07); color: #15171a; }
    .ctrl:focus-visible {
      outline: 2px solid #0E7C6B;
      outline-offset: 1px;
      background: rgba(14, 124, 107, 0.08);
      color: #0E7C6B;
    }
    .ctrl svg { display: block; }

    [hidden] { display: none !important; }

    /* Respect users who prefer no motion: drop the warned-dot pulse and the
       hover lift; keep transitions short so the UI still feels responsive. */
    @media (prefers-reduced-motion: reduce) {
      .pill[data-state="WARNED"] .dot { animation: none; }
      .pill:hover { transform: none; }
      .pill, .menu, .menu-action, .ctrl, .toast, .dot {
        transition-duration: 0.001ms !important;
        animation-duration: 0.001ms !important;
      }
    }

    /* ── Break-reminder modal ────────────────────────────────────────────── */

    .break-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 28, 0.42);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 2147483646;
    }
    .break-backdrop.visible { opacity: 1; pointer-events: auto; }

    .break-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, calc(-50% + 12px)) scale(0.96);
      width: min(440px, calc(100vw - 32px));
      background: #fdfcfa;
      color: #15171a;
      border-radius: 20px;
      padding: 28px 28px 22px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      box-shadow:
        0 1px 2px rgba(15, 23, 28, 0.06),
        0 24px 48px -16px rgba(15, 23, 28, 0.28),
        0 60px 120px -40px rgba(15, 23, 28, 0.35);
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1),
        transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 2147483647;
    }
    .break-modal.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, -50%) scale(1);
    }
    .break-modal[data-stage="final"] {
      box-shadow:
        0 0 0 1px rgba(194, 78, 58, 0.18),
        0 1px 2px rgba(15, 23, 28, 0.06),
        0 24px 48px -16px rgba(194, 78, 58, 0.28),
        0 60px 120px -40px rgba(15, 23, 28, 0.40);
    }

    .break-modal-head {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 14px;
    }
    .break-modal-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0F8674 0%, #138F7C 100%);
      color: #fdfcfa;
      flex-shrink: 0;
    }
    .break-modal[data-stage="final"] .break-modal-icon {
      background: linear-gradient(135deg, #C24E3A 0%, #D55C46 100%);
    }
    .break-modal-icon svg { width: 26px; height: 26px; }

    .break-modal-title {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: -0.01em;
      margin: 0;
    }
    .break-modal-eyebrow {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #0F8674;
      margin: 0 0 4px;
    }
    .break-modal[data-stage="final"] .break-modal-eyebrow {
      color: #C24E3A;
    }

    .break-modal-body {
      font-size: 15px;
      line-height: 1.55;
      color: #3a3a3a;
      margin: 0 0 22px;
    }
    .break-modal-meta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: #15171a;
      background: #f1efe7;
      border-radius: 999px;
      padding: 4px 10px;
      margin-bottom: 14px;
    }
    .break-modal-meta-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #0F8674;
    }
    .break-modal[data-stage="final"] .break-modal-meta-dot { background: #C24E3A; }

    .break-modal-error {
      font-size: 13px;
      line-height: 1.5;
      color: #C24E3A;
      background: rgba(194, 78, 58, 0.08);
      border: 1px solid rgba(194, 78, 58, 0.18);
      border-radius: 10px;
      padding: 10px 12px;
      margin: 0 0 14px;
    }
    .break-modal-error[hidden] { display: none !important; }

    .break-modal-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
    .break-btn {
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 18px;
      border-radius: 12px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: transform 0.12s ease, background 0.18s ease, box-shadow 0.18s ease;
      -webkit-font-smoothing: antialiased;
    }
    .break-btn:hover { transform: translateY(-1px); }
    .break-btn:active { transform: translateY(0); }
    .break-btn-primary {
      background: #15171a;
      color: #fdfcfa;
      box-shadow: 0 2px 6px rgba(15, 23, 28, 0.18);
    }
    .break-btn-primary:hover {
      background: #0F8674;
      box-shadow: 0 4px 14px rgba(15, 134, 116, 0.32);
    }
    .break-modal[data-stage="final"] .break-btn-primary:hover {
      background: #C24E3A;
      box-shadow: 0 4px 14px rgba(194, 78, 58, 0.32);
    }
    .break-btn-ghost {
      background: transparent;
      color: #6a6a6a;
      border-color: #e5e3da;
    }
    .break-btn-ghost:hover { color: #15171a; background: #f4f2ea; }

    @media (prefers-color-scheme: dark) {
      .break-modal {
        background: #1c1e22;
        color: #fdfcfa;
        box-shadow:
          0 0 0 1px rgba(255,255,255,0.04),
          0 24px 48px -16px rgba(0,0,0,0.6),
          0 60px 120px -40px rgba(0,0,0,0.7);
      }
      .break-modal-body { color: #c8c7c2; }
      .break-modal-meta { background: rgba(255,255,255,0.06); color: #fdfcfa; }
      .break-btn-primary { background: #fdfcfa; color: #15171a; }
      .break-btn-primary:hover { background: #0F8674; color: #fdfcfa; }
      .break-btn-ghost { color: #a7a6a1; border-color: rgba(255,255,255,0.12); }
      .break-btn-ghost:hover { background: rgba(255,255,255,0.06); color: #fdfcfa; }
    }

    @media (prefers-reduced-motion: reduce) {
      .break-modal, .break-backdrop { transition-duration: 0.001ms !important; }
    }
  `;

  // ── DOM ─────────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'root pos-bottom-right';

  const toast = document.createElement('div');
  toast.className = 'toast';

  // Menu — single floating panel containing action button + control icons.
  const menu = document.createElement('div');
  menu.className = 'menu';

  const menuAction = document.createElement('button');
  menuAction.className = 'menu-action action-in';
  menuAction.type = 'button';

  const menuSep = document.createElement('div');
  menuSep.className = 'menu-sep';

  const menuControls = document.createElement('div');
  menuControls.className = 'menu-controls';

  function shapeGlyphSvg(shape: OverlayShape): string {
    const inner = shape === 'circle'
      ? '<circle cx="8" cy="8" r="4"/>'
      : '<rect x="4" y="4" width="8" height="8" rx="1.6"/>';
    return `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">${inner}</svg>`;
  }

  function makeIconButton(svgPath: string, ariaLabel: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'ctrl';
    b.type = 'button';
    b.setAttribute('aria-label', ariaLabel);
    b.title = ariaLabel;
    b.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
    return b;
  }

  const btnShape    = document.createElement('button');
  btnShape.className = 'ctrl';
  btnShape.type = 'button';
  btnShape.setAttribute('aria-label', 'Shape');
  btnShape.title = 'Shape';

  const btnMinimize = makeIconButton('<path d="M3 8h10"/>', 'Minimise');
  const btnClose    = makeIconButton('<path d="M4 4l8 8M12 4l-8 8"/>', 'Close');
  // Pop-out icon: arrow leaving a box (open in floating window).
  const btnPip      = makeIconButton(
    '<path d="M9 3h4v4"/><path d="M13 3l-6 6"/><path d="M6 3H3v10h10v-3"/>',
    'Pop out',
  );
  btnPip.hidden = true;

  menuControls.appendChild(btnShape);
  menuControls.appendChild(btnPip);
  menuControls.appendChild(btnMinimize);
  menuControls.appendChild(btnClose);

  menu.appendChild(menuAction);
  menu.appendChild(menuSep);
  menu.appendChild(menuControls);

  // Pill — visual indicator only. No inline controls.
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.setAttribute('data-state', 'IDLE');
  pill.setAttribute('role', 'button');
  pill.setAttribute('aria-haspopup', 'menu');
  pill.setAttribute('aria-expanded', 'false');
  pill.tabIndex = 0;

  const dot = document.createElement('span');
  dot.className = 'dot';

  const pillTime = document.createElement('span');
  pillTime.className = 'time';

  const pillLabel = document.createElement('span');
  pillLabel.className = 'label';

  const launcherIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  launcherIcon.classList.add('launcher-icon');
  launcherIcon.setAttribute('viewBox', '0 0 24 24');
  launcherIcon.setAttribute('width', '18');
  launcherIcon.setAttribute('height', '18');
  launcherIcon.setAttribute('fill', 'none');
  launcherIcon.setAttribute('stroke', 'currentColor');
  launcherIcon.setAttribute('stroke-width', '2.2');
  launcherIcon.setAttribute('stroke-linecap', 'round');
  launcherIcon.setAttribute('stroke-linejoin', 'round');
  launcherIcon.innerHTML = `<path d="M12 17c-4-2-6-5-6-9 3 0 6 1.5 7.5 4.5"/><path d="M12 17c4-2 6-5 6-9-3 0-6 1.5-7.5 4.5"/><path d="M12 12v8"/>`;

  // Time comes first after the dot so it reads as the focal element.
  pill.appendChild(dot);
  pill.appendChild(pillTime);
  pill.appendChild(pillLabel);
  pill.appendChild(launcherIcon);

  root.appendChild(toast);
  root.appendChild(pill);
  root.appendChild(menu);

  // ── Break-reminder modal (centered, theme-aware, dismissible) ────────────
  const breakBackdrop = document.createElement('div');
  breakBackdrop.className = 'break-backdrop';

  const breakModal = document.createElement('div');
  breakModal.className = 'break-modal';
  breakModal.setAttribute('role', 'alertdialog');
  breakModal.setAttribute('aria-modal', 'true');
  breakModal.setAttribute('aria-labelledby', 'nh-break-title');
  breakModal.setAttribute('data-stage', 'first');

  const breakHead = document.createElement('div');
  breakHead.className = 'break-modal-head';

  const breakIcon = document.createElement('div');
  breakIcon.className = 'break-modal-icon';
  breakIcon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M17 8h1a4 4 0 0 1 0 8h-1"/>
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>
      <line x1="6" y1="2" x2="6" y2="4"/>
      <line x1="10" y1="2" x2="10" y2="4"/>
      <line x1="14" y1="2" x2="14" y2="4"/>
    </svg>
  `;

  const breakHeadText = document.createElement('div');
  const breakEyebrow = document.createElement('p');
  breakEyebrow.className = 'break-modal-eyebrow';
  breakEyebrow.id = 'nh-break-eyebrow';
  const breakTitle = document.createElement('h2');
  breakTitle.className = 'break-modal-title';
  breakTitle.id = 'nh-break-title';
  breakHeadText.appendChild(breakEyebrow);
  breakHeadText.appendChild(breakTitle);

  breakHead.appendChild(breakIcon);
  breakHead.appendChild(breakHeadText);

  const breakMeta = document.createElement('span');
  breakMeta.className = 'break-modal-meta';
  const breakMetaDot = document.createElement('span');
  breakMetaDot.className = 'break-modal-meta-dot';
  const breakMetaText = document.createElement('span');
  breakMeta.appendChild(breakMetaDot);
  breakMeta.appendChild(breakMetaText);

  const breakBody = document.createElement('p');
  breakBody.className = 'break-modal-body';

  const breakError = document.createElement('p');
  breakError.className = 'break-modal-error';
  breakError.hidden = true;

  const breakActions = document.createElement('div');
  breakActions.className = 'break-modal-actions';

  const breakBtnDismiss = document.createElement('button');
  breakBtnDismiss.type = 'button';
  breakBtnDismiss.className = 'break-btn break-btn-ghost';

  const breakBtnAck = document.createElement('button');
  breakBtnAck.type = 'button';
  breakBtnAck.className = 'break-btn break-btn-primary';

  breakActions.appendChild(breakBtnDismiss);
  breakActions.appendChild(breakBtnAck);

  breakModal.appendChild(breakHead);
  breakModal.appendChild(breakMeta);
  breakModal.appendChild(breakBody);
  breakModal.appendChild(breakError);
  breakModal.appendChild(breakActions);

  shadow.appendChild(style);
  shadow.appendChild(breakBackdrop);
  shadow.appendChild(breakModal);
  shadow.appendChild(root);
  document.body.appendChild(host);

  // SPA reconcilers (absence.io and most framework apps) can prune unknown
  // body children on route changes, which would silently delete our pill.
  // The host element keeps its shadow root and listeners after detach, so
  // simply re-appending it restores everything without re-running init.
  //
  // Only watch <body>'s direct children — NOT the whole subtree. SPAs fire
  // thousands of subtree mutations per minute (every render, every focus,
  // every tooltip). Subtree observation made this callback fire constantly,
  // which Chrome surfaces as a runtime error and may interleave our
  // appendChild inside React's commit phase.
  const reattachGuard = new MutationObserver(() => {
    if (!document.body) return;
    if (host.parentNode !== document.body) {
      document.body.appendChild(host);
    }
  });
  reattachGuard.observe(document.body, { childList: true });

  // ── State ───────────────────────────────────────────────────────────────────
  let t: Awaited<ReturnType<typeof loadMessages>>;
  let liveStampInTs: number | null = null;
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let lastWorkState: WorkState = 'IDLE';
  let lastTodayState: TodayState | null = null;
  let overlayEnabled = true;
  let overlayMinimized = false;
  let overlayPosition: OverlayPosition = 'bottom-right';
  let overlayCustomPos: OverlayCustomPos | null = null;
  let overlayShape: OverlayShape = 'circle';
  let sessionDismissed = false;
  let lastStampAt = 0;
  let pipEnabled = false;
  let pipWindow: Window | null = null;
  let pipTickInterval: ReturnType<typeof setInterval> | null = null;
  let pipRender: (() => void) | null = null;

  // Document Picture-in-Picture is a Chromium-only API (Chrome, Edge, Brave,
  // Arc, DIA, Opera, Vivaldi from v116). Firefox and Safari do not expose it.
  // Feature-detect at runtime and hide the pop-out control gracefully.
  interface DocumentPiP {
    requestWindow(opts?: { width?: number; height?: number }): Promise<Window>;
    window: Window | null;
  }
  function getDocumentPiP(): DocumentPiP | null {
    const api = (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;
    return api ?? null;
  }
  const pipSupported = getDocumentPiP() !== null;

  // ── Time formatting ─────────────────────────────────────────────────────────
  function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  function startTicker(): void {
    if (tickInterval !== null) return;
    tickInterval = setInterval(() => {
      if (liveStampInTs === null) return;
      // Mirror absence.io: show the current session only, not day total.
      pillTime.textContent = formatElapsed(Date.now() - liveStampInTs);
    }, 5000);
  }
  function stopTicker(): void {
    if (tickInterval !== null) { clearInterval(tickInterval); tickInterval = null; }
  }

  // ── Toast ───────────────────────────────────────────────────────────────────
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(text: string, isError = false): void {
    toast.textContent = text;
    toast.className = `toast visible${isError ? ' error' : ''}`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2400);
  }

  // ── Position the root anchor on screen ──────────────────────────────────────
  function applyPosition(): void {
    if (overlayCustomPos !== null) {
      root.className = 'root';
      root.style.top = `${overlayCustomPos.y}px`;
      root.style.left = `${overlayCustomPos.x}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      return;
    }
    root.className = `root pos-${overlayPosition}`;
    root.style.top = '';
    root.style.left = '';
    root.style.right = '';
    root.style.bottom = '';
  }

  // ── Position clamping ───────────────────────────────────────────────────────
  // When the user has dragged the pill (overlayCustomPos !== null), changing
  // shape can leave the pill partially off-screen because circle (72px) and
  // pill (~120px) have different widths but share a top-left anchor. This
  // helper re-clamps and (if it adjusted anything) persists the corrected
  // position so the next render matches.
  function clampCustomPosToViewport(): void {
    if (overlayCustomPos === null) return;
    if (root.classList.contains('is-hidden')) return;
    const rect = root.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const pad = 12;
    const maxX = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxY = Math.max(pad, window.innerHeight - rect.height - pad);
    const nextX = Math.max(pad, Math.min(maxX, overlayCustomPos.x));
    const nextY = Math.max(pad, Math.min(maxY, overlayCustomPos.y));
    if (nextX === overlayCustomPos.x && nextY === overlayCustomPos.y) return;
    const clamped: OverlayCustomPos = { x: nextX, y: nextY };
    overlayCustomPos = clamped;
    root.style.left = `${nextX}px`;
    root.style.top = `${nextY}px`;
    void (async () => {
      const prefs = await getStorage('preferences');
      await setStorage('preferences', { ...prefs, overlayCustomPos: clamped });
    })();
  }

  // ── Shape and visibility ────────────────────────────────────────────────────
  // Pulse is meaningful only when the user is actively clocked in. IDLE and
  // UNCONFIGURED both hide the widget completely on every site — clock-in
  // happens via the toolbar popup or directly on app.absence.io.
  function applyVisibilityAndSize(workState: WorkState): void {
    const shouldShow =
      overlayEnabled &&
      !sessionDismissed &&
      !denyListedHost &&
      (workState === 'WORKING' || workState === 'WARNED' || workState === 'SNOOZED');

    if (!shouldShow) {
      root.classList.add('is-hidden');
      hideMenuImmediate();
      return;
    }
    root.classList.remove('is-hidden');

    pill.classList.remove('compact', 'hidden-launcher', 'shape-circle', 'shape-square');
    if (overlayMinimized) {
      pill.classList.add('compact');
    } else {
      pill.classList.add(`shape-${overlayShape}`);
    }
    btnShape.innerHTML = shapeGlyphSvg(overlayShape);
    btnPip.hidden = !(pipSupported && pipEnabled);

    // After layout settles with the new shape, re-clamp any custom-dragged
    // position so a wider pill doesn't overflow the viewport edge.
    requestAnimationFrame(clampCustomPosToViewport);
  }

  // ── Pill render ─────────────────────────────────────────────────────────────
  function stateLabelText(s: WorkState): string {
    if (s === 'WARNED')  return t.timeToLeave;
    if (s === 'SNOOZED') return t.snoozed;
    if (s === 'WORKING') return t.clockedIn;
    return t.notClockedIn;
  }

  function renderState(workState: WorkState, todayState: TodayState | null): void {
    lastWorkState = workState;
    lastTodayState = todayState;
    applyPosition();
    applyVisibilityAndSize(workState);

    // Pill is hidden for IDLE / UNCONFIGURED / overlayEnabled=false / denylisted host.
    // Stop the live ticker so we don't burn CPU updating an invisible label.
    if (root.classList.contains('is-hidden')) {
      stopTicker();
      liveStampInTs = null;
      return;
    }

    const clocked = workState === 'WORKING' || workState === 'WARNED' || workState === 'SNOOZED';
    pill.setAttribute('data-state', workState);
    pillLabel.textContent = stateLabelText(workState);

    if (clocked && todayState !== null && todayState.stampInTimestamp !== null) {
      liveStampInTs = todayState.stampInTimestamp;
      pillTime.textContent = formatElapsed(Date.now() - liveStampInTs);
      startTicker();
    } else {
      stopTicker();
      liveStampInTs = null;
      pillTime.textContent = '0:00';
    }

    updateMenuAction(workState, clocked);
    // Keep the floating PiP window in sync with server-driven state changes.
    if (pipRender !== null) pipRender();
  }

  // ── Menu action button ──────────────────────────────────────────────────────
  function updateMenuAction(workState: WorkState, clocked: boolean): void {
    if (!t) return;
    if (clocked) {
      menuAction.className = `menu-action ${workState === 'WARNED' ? 'action-warn' : 'action-out'}`;
      menuAction.textContent = workState === 'WARNED' ? t.overlayClockOutNow : t.overlayClockOut;
    } else {
      menuAction.className = 'menu-action action-in';
      menuAction.textContent = t.overlayClockIn;
    }
  }

  function sendMessage(msg: Message): Promise<StateResponse> {
    return chrome.runtime.sendMessage(msg) as Promise<StateResponse>;
  }

  function refreshState(): void {
    sendMessage({ type: 'GET_STATE' })
      .then((resp) => { if (resp) renderState(resp.workState, resp.todayState); })
      .catch(() => {});
  }

  // ── Menu show / hide / position ─────────────────────────────────────────────
  let menuHideTimer: ReturnType<typeof setTimeout> | null = null;

  function positionMenu(): void {
    if (!menu.classList.contains('visible')) return;

    const margin = 10;
    const gap = 8;
    const pillRect = pill.getBoundingClientRect();
    // Render-once measurement: temporarily ensure it has size for measuring.
    const menuRect = menu.getBoundingClientRect();
    const menuW = menuRect.width;
    const menuH = menuRect.height;

    // Vertical: prefer above pill, fall back to below, then clamp.
    let top = pillRect.top - menuH - gap;
    if (top < margin) {
      const belowTop = pillRect.bottom + gap;
      if (belowTop + menuH <= window.innerHeight - margin) {
        top = belowTop;
      } else {
        // Neither above nor below fully fits — choose the side with more room.
        const roomAbove = pillRect.top;
        const roomBelow = window.innerHeight - pillRect.bottom;
        top = roomAbove >= roomBelow
          ? Math.max(margin, pillRect.top - menuH - gap)
          : Math.min(window.innerHeight - menuH - margin, pillRect.bottom + gap);
      }
    }

    // Horizontal: align right edge of menu with right edge of pill, then clamp.
    let left = pillRect.right - menuW;
    left = Math.max(margin, Math.min(window.innerWidth - menuW - margin, left));

    // Also clamp top in case viewport is shorter than menu.
    top = Math.max(margin, Math.min(window.innerHeight - menuH - margin, top));

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }

  function showMenu(): void {
    if (!overlayEnabled || root.classList.contains('is-hidden')) return;
    if (menuHideTimer !== null) { clearTimeout(menuHideTimer); menuHideTimer = null; }
    menu.classList.add('visible');
    pill.setAttribute('aria-expanded', 'true');
    // Two-pass position: measure after a paint so dimensions are accurate.
    requestAnimationFrame(positionMenu);
    requestAnimationFrame(() => requestAnimationFrame(positionMenu));
  }

  function scheduleHideMenu(): void {
    if (menuHideTimer !== null) clearTimeout(menuHideTimer);
    menuHideTimer = setTimeout(() => {
      menu.classList.remove('visible');
      pill.setAttribute('aria-expanded', 'false');
      menuHideTimer = null;
    }, 260);
  }

  function hideMenuImmediate(): void {
    if (menuHideTimer !== null) { clearTimeout(menuHideTimer); menuHideTimer = null; }
    menu.classList.remove('visible');
    pill.setAttribute('aria-expanded', 'false');
  }

  // ── Drag-and-drop on pill ───────────────────────────────────────────────────
  const DRAG_THRESHOLD_PX = 4;
  let dragStart: { px: number; py: number; left: number; top: number } | null = null;
  let isDragging = false;
  let suppressNextClick = false;

  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const rect = root.getBoundingClientRect();
    dragStart = { px: e.clientX, py: e.clientY, left: rect.left, top: rect.top };
    isDragging = false;
    try { pill.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  pill.addEventListener('pointermove', (e) => {
    if (dragStart === null) return;
    const dx = e.clientX - dragStart.px;
    const dy = e.clientY - dragStart.py;
    if (!isDragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      isDragging = true;
      pill.classList.add('dragging');
      hideMenuImmediate();
    }
    if (!isDragging) return;

    const rect = root.getBoundingClientRect();
    const pad = 8;
    const newLeft = Math.max(pad, Math.min(window.innerWidth - rect.width - pad, dragStart.left + dx));
    const newTop  = Math.max(pad, Math.min(window.innerHeight - rect.height - pad, dragStart.top + dy));
    root.style.left = `${newLeft}px`;
    root.style.top  = `${newTop}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  });

  function endDrag(e: PointerEvent): void {
    if (dragStart === null) return;
    try { pill.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (isDragging) {
      suppressNextClick = true;
      pill.classList.remove('dragging');
      const rect = root.getBoundingClientRect();
      const pos: OverlayCustomPos = { x: Math.round(rect.left), y: Math.round(rect.top) };
      void (async () => {
        const prefs = await getStorage('preferences');
        await setStorage('preferences', { ...prefs, overlayCustomPos: pos });
      })();
    }
    isDragging = false;
    dragStart = null;
  }
  pill.addEventListener('pointerup', endDrag);
  pill.addEventListener('pointercancel', endDrag);

  // Re-clamp custom position if the window shrinks.
  window.addEventListener('resize', () => {
    clampCustomPosToViewport();
    positionMenu();
  });

  window.addEventListener('scroll', positionMenu, { passive: true });

  // ── Pill click → show menu ─────────────────────────────────────────────────
  // UNCONFIGURED and IDLE both hide the host, so the click only reaches us
  // when the user is actively clocked in.
  pill.addEventListener('click', (e) => {
    if (suppressNextClick) { suppressNextClick = false; e.stopPropagation(); return; }
    showMenu();
  });

  // ── Hover triggers (with delay) ─────────────────────────────────────────────
  pill.addEventListener('mouseenter', showMenu);
  pill.addEventListener('mouseleave', scheduleHideMenu);
  menu.addEventListener('mouseenter', showMenu);
  menu.addEventListener('mouseleave', scheduleHideMenu);

  // Click anywhere outside the widget closes the menu.
  document.addEventListener('click', (e) => {
    if (!host.contains(e.target as Node)) hideMenuImmediate();
  });

  // ── Action button ───────────────────────────────────────────────────────────
  menuAction.addEventListener('click', (e) => {
    e.stopPropagation();
    const clocked = lastWorkState === 'WORKING' || lastWorkState === 'WARNED' || lastWorkState === 'SNOOZED';
    const msgType: Message['type'] = clocked ? 'STAMP_OUT' : 'STAMP_IN';
    const pendingText = clocked ? t.overlayClockOut : t.overlayClockIn;
    menuAction.disabled = true;
    showToast(`${pendingText}…`);
    void sendMessage({ type: msgType }).then((resp) => {
      if (resp) {
        renderState(resp.workState, resp.todayState);
        showToast(resp.error ?? (clocked ? t.overlayClockedOutToast : t.overlayClockedInToast), !!resp.error);
      }
      menuAction.disabled = false;
      hideMenuImmediate();
    }).catch(() => {
      showToast(t.overlayCannotConnect, true);
      menuAction.disabled = false;
    });
  });

  // ── Control buttons ─────────────────────────────────────────────────────────
  function nextShape(current: OverlayShape): OverlayShape {
    if (current === 'circle') return 'square';
    return 'circle';
  }
  btnShape.addEventListener('click', async (e) => {
    e.stopPropagation();
    const prefs = await getStorage('preferences');
    await setStorage('preferences', { ...prefs, overlayShape: nextShape(overlayShape) });
  });

  btnMinimize.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideMenuImmediate();
    const prefs = await getStorage('preferences');
    await setStorage('preferences', { ...prefs, overlayMinimized: !prefs.overlayMinimized });
  });

  btnClose.addEventListener('click', (e) => {
    e.stopPropagation();
    hideMenuImmediate();
    sessionDismissed = true;
    applyVisibilityAndSize(lastWorkState);
  });

  // ── Pop-out floating window (Document Picture-in-Picture) ───────────────────
  // Always-on-top window that survives tab switches and works above chrome://
  // surfaces. Requires Chromium 116+ (Chrome, Edge, Brave, Arc, DIA, Opera,
  // Vivaldi). On unsupported browsers btnPip stays hidden, so this code path
  // is never reached.
  function buildPipDocument(win: Window): void {
    const doc = win.document;
    doc.title = 'Pulse';

    const style = doc.createElement('style');
    style.textContent = `
      *,*::before,*::after { box-sizing: border-box; }
      html,body { height: 100%; margin: 0; }
      body {
        background: #f6f4ee;
        color: #15171a;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px 16px;
      }
      .pip-card {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        width: 100%;
      }
      .pip-pill {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #ffffff;
        border: 1px solid #e5e3da;
        border-radius: 999px;
        box-shadow: 0 1px 2px rgba(21,23,26,0.06), 0 8px 24px -8px rgba(21,23,26,0.18);
      }
      .pip-pill[data-state="WORKING"] { background: linear-gradient(180deg, #effaf6 0%, #ddf2e9 100%); border-color: #b8e0d2; color: #0B4F44; }
      .pip-pill[data-state="WARNED"]  { background: linear-gradient(180deg, #fdf4e6 0%, #fbeede 100%); border-color: #f1d5b4; color: #823e09; }
      .pip-pill[data-state="SNOOZED"] { background: linear-gradient(180deg, #faf3dc 0%, #f5edd2 100%); border-color: #e0d5b0; color: #5e4d11; }
      .pip-pill[data-state="IDLE"]    { background: #ffffff; border-color: #e5e3da; color: #525751; }
      .pip-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: #8e9089;
        box-shadow: 0 0 0 3px rgba(142, 144, 137, 0.18);
        flex-shrink: 0;
      }
      .pip-pill[data-state="WORKING"] .pip-dot { background: #0F8674; box-shadow: 0 0 0 3px rgba(15, 134, 116, 0.22); }
      .pip-pill[data-state="WARNED"]  .pip-dot { background: #C97A1A; box-shadow: 0 0 0 3px rgba(201, 122, 26, 0.22); animation: pip-pulse 1.8s ease-in-out infinite; }
      .pip-pill[data-state="SNOOZED"] .pip-dot { background: #846b1a; box-shadow: 0 0 0 3px rgba(132, 107, 26, 0.20); }
      @keyframes pip-pulse {
        0%, 100% { box-shadow: 0 0 0 3px rgba(201, 122, 26, 0.22), 0 0 0 0 rgba(201, 122, 26, 0.45); }
        50%      { box-shadow: 0 0 0 3px rgba(201, 122, 26, 0.22), 0 0 0 8px rgba(201, 122, 26, 0); }
      }
      .pip-time {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        flex: 1;
      }
      .pip-label {
        font-size: 11px;
        font-weight: 500;
        opacity: 0.7;
        letter-spacing: 0.01em;
        text-align: right;
      }
      .pip-action {
        padding: 10px 14px;
        border: none;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        font-family: inherit;
        color: #fdfcfa;
        cursor: pointer;
        transition: opacity 0.15s ease, transform 0.08s ease;
        width: 100%;
      }
      .pip-action:active:not(:disabled) { transform: translateY(1px); }
      .pip-action:disabled { opacity: 0.55; cursor: not-allowed; }
      .pip-action.pip-action-in   { background: linear-gradient(135deg, #0E7C6B 0%, #14A38B 100%); }
      .pip-action.pip-action-out  { background: linear-gradient(135deg, #C24E3A 0%, #E26A56 100%); }
      .pip-action.pip-action-warn { background: linear-gradient(135deg, #C97A1A 0%, #E09430 100%); }
    `;
    doc.head.appendChild(style);

    const card = doc.createElement('div');
    card.className = 'pip-card';

    const pillEl = doc.createElement('div');
    pillEl.className = 'pip-pill';
    pillEl.setAttribute('data-state', 'IDLE');

    const dotEl = doc.createElement('span');
    dotEl.className = 'pip-dot';

    const timeEl = doc.createElement('span');
    timeEl.className = 'pip-time';
    timeEl.textContent = '0:00';

    const labelEl = doc.createElement('span');
    labelEl.className = 'pip-label';

    const actionBtn = doc.createElement('button');
    actionBtn.className = 'pip-action pip-action-in';
    actionBtn.type = 'button';
    actionBtn.textContent = '...';

    pillEl.appendChild(dotEl);
    pillEl.appendChild(timeEl);
    pillEl.appendChild(labelEl);
    card.appendChild(pillEl);
    card.appendChild(actionBtn);
    doc.body.appendChild(card);

    function render(): void {
      if (!t) return;
      const clocked = lastWorkState === 'WORKING' || lastWorkState === 'WARNED' || lastWorkState === 'SNOOZED';
      pillEl.setAttribute('data-state', lastWorkState);
      labelEl.textContent = stateLabelText(lastWorkState);
      if (clocked && liveStampInTs !== null) {
        timeEl.textContent = formatElapsed(Date.now() - liveStampInTs);
      } else if (lastTodayState !== null && lastTodayState.elapsedMsToday > 0) {
        timeEl.textContent = formatElapsed(lastTodayState.elapsedMsToday);
      } else {
        timeEl.textContent = '0:00';
      }
      if (clocked) {
        actionBtn.className = `pip-action ${lastWorkState === 'WARNED' ? 'pip-action-warn' : 'pip-action-out'}`;
        actionBtn.textContent = lastWorkState === 'WARNED' ? t.overlayClockOutNow : t.overlayClockOut;
      } else {
        actionBtn.className = 'pip-action pip-action-in';
        actionBtn.textContent = t.overlayClockIn;
      }
    }

    actionBtn.addEventListener('click', () => {
      const clocked = lastWorkState === 'WORKING' || lastWorkState === 'WARNED' || lastWorkState === 'SNOOZED';
      actionBtn.disabled = true;
      void sendMessage({ type: clocked ? 'STAMP_OUT' : 'STAMP_IN' }).then((resp) => {
        if (resp) renderState(resp.workState, resp.todayState);
        actionBtn.disabled = false;
        render();
      }).catch(() => { actionBtn.disabled = false; });
    });

    pipRender = render;
    render();

    if (pipTickInterval !== null) clearInterval(pipTickInterval);
    pipTickInterval = setInterval(render, 1000);

    win.addEventListener('pagehide', () => {
      if (pipTickInterval !== null) { clearInterval(pipTickInterval); pipTickInterval = null; }
      pipWindow = null;
      pipRender = null;
    });
  }

  async function openPipWindow(): Promise<void> {
    const api = getDocumentPiP();
    if (!api) { showToast(t.overlayPipUnsupported, true); return; }
    if (pipWindow !== null && !pipWindow.closed) {
      try { pipWindow.focus(); } catch { /* ignore */ }
      return;
    }
    try {
      const win = await api.requestWindow({ width: 260, height: 150 });
      pipWindow = win;
      buildPipDocument(win);
      showToast(t.overlayPipOpened);
    } catch {
      showToast(t.overlayPipUnsupported, true);
    }
  }

  btnPip.addEventListener('click', (e) => {
    e.stopPropagation();
    hideMenuImmediate();
    void openPipWindow();
  });

  // ── Storage sync ────────────────────────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const prefsChange = changes['preferences'];
    if (prefsChange?.newValue) {
      const np = prefsChange.newValue as {
        overlayEnabled?: boolean;
        overlayMinimized?: boolean;
        overlayPosition?: OverlayPosition;
        overlayShape?: OverlayShape;
        overlayCustomPos?: OverlayCustomPos | null;
        pipEnabled?: boolean;
        language?: string;
      };
      const oldLang = (prefsChange.oldValue as { language?: string } | undefined)?.language;
      const reloadI18n = oldLang !== np.language;
      overlayEnabled   = np.overlayEnabled ?? overlayEnabled;
      overlayMinimized = np.overlayMinimized ?? overlayMinimized;
      overlayPosition  = np.overlayPosition ?? overlayPosition;
      overlayShape     = np.overlayShape ?? overlayShape;
      pipEnabled       = np.pipEnabled ?? pipEnabled;
      if ('overlayCustomPos' in np) {
        overlayCustomPos = np.overlayCustomPos ?? null;
      }
      applyPosition();
      applyVisibilityAndSize(lastWorkState);
      // If the menu is open, reposition it after the pill resizes.
      requestAnimationFrame(positionMenu);

      // When the overlay is re-enabled, force a live state fetch so the pill
      // renders with current data rather than a potentially stale local copy.
      if (np.overlayEnabled === true) {
        refreshState();
      }

      if (reloadI18n) {
        void loadMessages().then((m) => {
          t = m;
          renderState(lastWorkState, lastTodayState);
        });
      }
    }
    if (changes['todayState'] || changes['workState']) {
      refreshState();
    }
    // Auto-reload absence.io's UI after our extension fires a stamp action.
    const stampChange = changes['lastStampActionAt'];
    if (
      stampChange !== undefined &&
      typeof stampChange.newValue === 'number' &&
      stampChange.newValue > lastStampAt &&
      Date.now() - stampChange.newValue < 5000 &&
      location.hostname === 'app.absence.io'
    ) {
      lastStampAt = stampChange.newValue;
      setTimeout(() => { location.reload(); }, 400);
    }
  });

  // ── Break-reminder modal show / hide ─────────────────────────────────────
  function showBreakModal(stage: 'first' | 'final', hours: number): void {
    const hourStr = hours % 1 === 0 ? String(hours) : hours.toFixed(1);
    breakModal.setAttribute('data-stage', stage);
    breakEyebrow.textContent = stage === 'final'
      ? (t.breakModalEyebrowFinal ?? 'Pause jetzt')
      : (t.breakModalEyebrowFirst ?? 'Pausenerinnerung');
    breakTitle.textContent = t.breakNotificationTitle;
    breakMetaText.textContent = (t.breakModalContinuousLabel ?? 'Am Stück gearbeitet: ') + `${hourStr} h`;
    breakBody.textContent = stage === 'final'
      ? t.breakNotificationBodyFinal
      : t.breakNotificationBodyFirst(hourStr);
    breakBtnDismiss.textContent = t.breakModalLater ?? 'Später';
    breakBtnAck.textContent = t.breakModalAck ?? t.breakNotificationDismiss;

    // Reset any error state from a previous open.
    breakError.hidden = true;
    breakError.textContent = '';
    breakBtnAck.disabled = false;
    breakBtnDismiss.disabled = false;

    // Force reflow so the transition runs even when re-showing.
    void breakModal.offsetWidth;
    breakBackdrop.classList.add('visible');
    breakModal.classList.add('visible');
    // Move keyboard focus into the modal for accessibility.
    setTimeout(() => { try { breakBtnAck.focus(); } catch { /* ignore */ } }, 60);
  }

  function hideBreakModal(): void {
    breakBackdrop.classList.remove('visible');
    breakModal.classList.remove('visible');
  }

  // Primary button: actually take a break. We call STAMP_OUT on absence.io
  // through the existing SW handler — same path the toolbar popup uses — so
  // the user's break starts the moment they click. If they aren't clocked in
  // (race with website clock-out), the SW just no-ops and the modal closes.
  breakBtnAck.addEventListener('click', () => {
    breakBtnAck.disabled = true;
    breakBtnDismiss.disabled = true;
    breakError.hidden = true;
    const originalLabel = breakBtnAck.textContent;
    breakBtnAck.textContent = t.clockingOut;
    void sendMessage({ type: 'STAMP_OUT' }).then((resp) => {
      breakBtnAck.disabled = false;
      breakBtnDismiss.disabled = false;
      breakBtnAck.textContent = originalLabel;
      if (resp && resp.error) {
        breakError.textContent = resp.error;
        breakError.hidden = false;
        return;
      }
      hideBreakModal();
    }).catch(() => {
      breakBtnAck.disabled = false;
      breakBtnDismiss.disabled = false;
      breakBtnAck.textContent = originalLabel;
      breakError.textContent = t.overlayCannotConnect;
      breakError.hidden = false;
    });
  });
  breakBtnDismiss.addEventListener('click', () => { hideBreakModal(); });
  breakBackdrop.addEventListener('click', () => { hideBreakModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && breakModal.classList.contains('visible')) hideBreakModal();
  });

  // ── Incoming messages from popup / service worker ────────────────────────────
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as { type?: string; stage?: 'first' | 'final'; hours?: number };
    if (msg.type === 'RESET_OVERLAY_DISMISS') {
      sessionDismissed = false;
      applyVisibilityAndSize(lastWorkState);
      sendResponse(undefined);
      return false;
    }
    if (msg.type === 'SHOW_BREAK_MODAL') {
      const stage = msg.stage === 'final' ? 'final' : 'first';
      const hours = typeof msg.hours === 'number' ? msg.hours : (stage === 'final' ? 5.5 : 5);
      showBreakModal(stage, hours);
      sendResponse(undefined);
      return false;
    }
    return false;
  });

  // ── Init ────────────────────────────────────────────────────────────────────
  (async () => {
    const [prefs, messages] = await Promise.all([getStorage('preferences'), loadMessages()]);
    t = messages;
    overlayEnabled   = prefs.overlayEnabled   ?? true;
    overlayMinimized = prefs.overlayMinimized ?? false;
    overlayPosition  = prefs.overlayPosition  ?? 'bottom-right';
    overlayCustomPos = prefs.overlayCustomPos ?? null;
    overlayShape     = prefs.overlayShape     ?? 'circle';
    pipEnabled       = prefs.pipEnabled       ?? false;
    lastStampAt      = await getStorage('lastStampActionAt');
    btnPip.setAttribute('aria-label', t.overlayPopOut);
    btnPip.title = t.overlayPopOut;
    applyPosition();
    refreshState();
  })();
}
