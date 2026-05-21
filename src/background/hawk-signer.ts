// Hawk 1.0 client authentication using Web Crypto API (crypto.subtle).
// No external dependency — service workers have crypto.subtle natively.
//
// Spec reference: https://github.com/mozilla/hawk
// Normalized string format verified against @hapi/hawk/lib/browser.js source.

export interface HawkCredentials {
  id: string;
  key: string;
  algorithm: 'sha256';
}

export interface HawkSignOptions {
  payload?: string;
  contentType?: string;
}

export interface HawkHeader {
  header: string;
}

const HAWK_VERSION = '1';

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => chars[b % chars.length]!)
    .join('');
}

function parseUri(url: string): { host: string; port: string; resource: string } {
  // scheme://[credentials@]host[:port][resource][#fragment]
  const match = url.match(/^([^:]+):\/\/(?:[^@/]*@)?([^/:]+)(?::(\d+))?([^#]*)(?:#.*)?$/);
  if (!match) return { host: '', port: '', resource: '' };
  const scheme = (match[1] ?? '').toLowerCase();
  return {
    host: match[2] ?? '',
    port: match[3] ?? (scheme === 'https' ? '443' : '80'),
    resource: match[4] ?? '',
  };
}

async function bufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

async function hmacSha256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return bufferToBase64(sig);
}

async function sha256(message: string): Promise<string> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(message));
  return bufferToBase64(hash);
}

async function payloadHash(body: string, contentType: string): Promise<string> {
  const ct = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return sha256(`hawk.${HAWK_VERSION}.payload\n${ct}\n${body}\n`);
}

export async function signRequest(
  url: string,
  method: string,
  credentials: HawkCredentials,
  options?: HawkSignOptions,
): Promise<HawkHeader> {
  const uri = parseUri(url);
  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomNonce();

  const hash =
    options?.payload !== undefined
      ? await payloadHash(options.payload, options.contentType ?? 'application/json')
      : '';

  // Normalized string per Hawk spec — must match this exact format
  const normalized =
    `hawk.${HAWK_VERSION}.header\n` +
    `${ts}\n` +
    `${nonce}\n` +
    `${method.toUpperCase()}\n` +
    `${uri.resource}\n` +
    `${uri.host.toLowerCase()}\n` +
    `${uri.port}\n` +
    `${hash}\n` +
    `\n`; // empty ext field, required trailing newline

  const mac = await hmacSha256(credentials.key, normalized);

  let header = `Hawk id="${credentials.id}", ts="${ts}", nonce="${nonce}"`;
  if (hash) header += `, hash="${hash}"`;
  header += `, mac="${mac}"`;

  return { header };
}
