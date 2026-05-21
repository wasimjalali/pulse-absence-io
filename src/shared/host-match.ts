// Matches a hostname against a list of user-provided patterns. Designed for
// the Pulse overlay's site denylist (banking sites, password managers, etc.).
//
// Supported pattern forms (case-insensitive, leading/trailing whitespace
// stripped, lines beginning with `#` ignored as comments):
//
//   - exact:       accounts.google.com
//   - subdomain:   *.paypal.com   (matches paypal.com AND foo.paypal.com)
//   - glob:        *bank*         (matches anything containing "bank")
//
// The glob form is escaped except for `*`, so it is safe to feed user input
// without worrying about regex injection.

function escapeForRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

export function hostMatches(hostname: string, patterns: readonly string[]): boolean {
  const h = hostname.toLowerCase();
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (p === '' || p.startsWith('#')) continue;

    if (p.startsWith('*.')) {
      const bare = p.slice(2);
      if (h === bare || h.endsWith('.' + bare)) return true;
      continue;
    }

    if (p.includes('*')) {
      const re = new RegExp('^' + p.split('*').map(escapeForRegex).join('.*') + '$');
      if (re.test(h)) return true;
      continue;
    }

    if (h === p) return true;
  }
  return false;
}
