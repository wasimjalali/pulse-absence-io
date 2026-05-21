// absence.io API v2 client. All network calls go through here.
// Every request is Hawk-signed. Error handling per plan §7.14.

import { signRequest } from './hawk-signer';
import { API_BASE } from '../shared/constants';
import type {
  AbsenceUser,
  AbsenceUsersResponse,
  Timespan,
  TimespansResponse,
  NewTimespan,
} from '../shared/types';

export interface ClientCredentials {
  hawkId: string;
  hawkKey: string;
  userId: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number, // 0 = network failure
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function hawkFetch(
  url: string,
  method: string,
  creds: ClientCredentials,
  body?: unknown,
): Promise<Response> {
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

  const { header } = await signRequest(
    url,
    method,
    { id: creds.hawkId, key: creds.hawkKey, algorithm: 'sha256' },
    bodyStr !== undefined
      ? { payload: bodyStr, contentType: 'application/json' }
      : undefined,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: header,
        ...(bodyStr !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: bodyStr,
    });
  } catch (err) {
    throw new ApiError(0, `Network error: ${String(err)}`);
  }

  if (!response.ok) {
    let body = '';
    try { body = (await response.text()).slice(0, 240); } catch { /* ignore */ }
    throw new ApiError(
      response.status,
      `${method} ${url} → ${response.status}${body ? ` · ${body}` : ''}`,
    );
  }

  return response;
}

// Returns the authenticated user's record and permission flags.
// Call once at onboarding; userId from data[0]._id is cached in storage.
export async function fetchCurrentUser(creds: ClientCredentials): Promise<AbsenceUser> {
  const url = `${API_BASE}/users`;
  const body = { limit: 1 };
  const response = await hawkFetch(url, 'POST', creds, body);
  const data: AbsenceUsersResponse = await response.json() as AbsenceUsersResponse;
  const user = data.data[0];
  if (!user) throw new ApiError(0, 'No user record returned from /users');
  return user;
}

// Returns work timespans for the authenticated user in a 48-hour UTC window
// centred on today (yesterday-start → tomorrow-start). The wider window catches
// two cases the today-only query misses:
//   (a) an open timespan that was started yesterday and is still open now
//       (overnight clock-in, or a forgotten clock-out from the previous day);
//   (b) the brief sliver after midnight UTC reset where today's just-rolled-over
//       state still has the previous day's open span attached.
// computeElapsed in service-worker is the consumer; it filters to today's
// elapsed locally while keeping any open span regardless of its start date.
//
// Filter syntax (MongoDB-style $gte/$lt) is plan-§10 unverified. If absence.io
// ignores the filter and returns everything, limit=100 caps response size.
export async function fetchTodayTimespans(creds: ClientCredentials): Promise<Timespan[]> {
  const url = `${API_BASE}/timespans`;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const windowStart = new Date(todayStart.getTime() - 86_400_000);
  const windowEnd = new Date(todayStart.getTime() + 86_400_000);

  const body = {
    filter: {
      userId: creds.userId,
      start: {
        $gte: windowStart.toISOString(),
        $lt: windowEnd.toISOString(),
      },
    },
    limit: 100,
  };

  const response = await hawkFetch(url, 'POST', creds, body);
  const data: TimespansResponse = await response.json() as TimespansResponse;
  return data.data;
}

// Stamps in: creates an open work timespan starting now.
// Endpoint pinned from the official Postman collection at docs.absence.io.
// `extractTimespan` still peels common wrapper shapes ({timespan: …},
// {data: …}) and throws if the response body has no `_id`, so a malformed
// 2xx never lets the popup show "started" while the server has nothing.
export async function createTimespan(
  creds: ClientCredentials,
  startTime: Date,
): Promise<Timespan> {
  const url = `${API_BASE}/timespans/create`;
  const payload: NewTimespan = {
    userId: creds.userId,
    start: startTime.toISOString(),
    type: 'work',
  };

  const response = await hawkFetch(url, 'POST', creds, payload);
  const raw = await response.json() as unknown;
  const timespan = extractTimespan(raw);
  if (timespan === null) {
    const snippet = JSON.stringify(raw).slice(0, 200);
    throw new ApiError(0, `${url} returned 2xx without a timespan _id (got ${snippet})`);
  }
  return timespan;
}

// Some APIs wrap responses in {data: ...} or {timespan: ...}. Peel those.
function extractTimespan(raw: unknown): Timespan | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj['_id'] === 'string') return obj as unknown as Timespan;
  for (const key of ['timespan', 'entry', 'result', 'data']) {
    const inner = obj[key];
    if (inner !== null && typeof inner === 'object' && typeof (inner as Record<string, unknown>)['_id'] === 'string') {
      return inner as unknown as Timespan;
    }
  }
  return null;
}

// Stamps out: sets the end time on an open timespan.
//
// Body includes the full span (start, userId, type) alongside end. Why: under
// strict REST PUT semantics ("replace the entire resource"), a body containing
// only `end` could cause absence.io to null out start/userId/type and the span
// ends up with start defaulted to "now", giving a 0-duration close that wipes
// the user's hours. Sending all fields is safe under both PUT-as-replace and
// PUT-as-partial-update interpretations.
export async function closeTimespan(
  creds: ClientCredentials,
  timespanId: string,
  startTime: Date,
  endTime: Date,
): Promise<Timespan> {
  const url = `${API_BASE}/timespans/${timespanId}`;
  const body = {
    userId: creds.userId,
    type: 'work',
    start: startTime.toISOString(),
    end: endTime.toISOString(),
  };
  const response = await hawkFetch(url, 'PUT', creds, body);
  return response.json() as Promise<Timespan>;
}
