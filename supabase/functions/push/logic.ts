// VINTAGE · push · the parts that do not touch the database
//
// Kept apart from index.ts so they can be tested where the function does
// not run (vitest, tests/push-function.test.ts): no Deno globals, no
// network of their own, no imports. index.ts gives them its fetch.

export interface Message {
  to: string;
  title?: string;
  body: string;
  data: Record<string, string>;
  sound: "default" | null;
  /** Expo collapses notifications sharing a thread on the lock screen. */
  channelId?: string;
}

/** Expo takes at most a hundred notices a request. */
export const EXPO_BATCH = 100;
/** Requests to Expo in flight at once. */
export const EXPO_AT_ONCE = 4;
/** How long one request to Expo may take before it is given up on. */
export const EXPO_TIMEOUT_MS = 15_000;
/** Ids per database read: an `in` filter rides in the URL, which has a ceiling. */
export const IDS_PER_READ = 100;

/** The list without repeats, in runs of `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const unique = [...new Set(items)];
  const out: T[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

/** Run `work` over the chunks, `atOnce` at a time; results in chunk order. */
export async function eachChunk<T, R>(
  chunks: T[][],
  atOnce: number,
  work: (chunk: T[], index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      out[index] = await work(chunks[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, chunks.length) }, worker));
  return out;
}

export interface SendResult {
  sent: number;
  failed: number;
  /** Tokens Expo says no longer reach a device: to be forgotten. */
  dead: string[];
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Hand the notices to Expo, a hundred a request, a few requests at once.
 * A request that hangs is given up on after `timeoutMs` and counted as
 * failed; one Expo is too busy for (429, 5xx) is tried once more after a
 * pause. A device Expo reports as gone (DeviceNotRegistered) is returned
 * in `dead`. Nothing here throws: a notice that cannot be sent is a notice
 * that was not sent, never a failed like or comment.
 */
export async function sendToExpo(
  messages: Message[],
  {
    fetch,
    url = "https://exp.host/--/api/v2/push/send",
    timeoutMs = EXPO_TIMEOUT_MS,
    batch = EXPO_BATCH,
    atOnce = EXPO_AT_ONCE,
    retryAfterMs = 1_000,
  }: { fetch: Fetch; url?: string; timeoutMs?: number; batch?: number; atOnce?: number; retryAfterMs?: number },
): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, dead: [] };
  const batches: Message[][] = [];
  for (let i = 0; i < messages.length; i += batch) batches.push(messages.slice(i, i + batch));

  const post = async (body: Message[]): Promise<Response | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  await eachChunk(batches, atOnce, async (body) => {
    let res = await post(body);
    if (res && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, retryAfterMs));
      res = await post(body);
    }
    if (!res || !res.ok) {
      result.failed += body.length;
      return;
    }
    let tickets: { status?: string; details?: { error?: string } }[] = [];
    try {
      const parsed = (await res.json()) as { data?: typeof tickets };
      tickets = Array.isArray(parsed?.data) ? parsed.data : [];
    } catch {
      tickets = [];
    }
    body.forEach((message, index) => {
      const ticket = tickets[index];
      if (ticket?.status === "ok") {
        result.sent++;
        return;
      }
      result.failed++;
      if (ticket?.details?.error === "DeviceNotRegistered") result.dead.push(message.to);
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// On this day
// ---------------------------------------------------------------------------

/** A calendar day, in UTC, in an earlier year: [start, end). */
export interface Day {
  year: number;
  start: string;
  end: string;
}

/**
 * Today's month and day in every earlier year from `firstYear`, newest
 * year first: the windows a photograph's capture date must fall in to be
 * a memory today. A day that year did not have (29 February outside a
 * leap year) is left out, as the old month-and-day comparison left it
 * out. At most `span` years back, so a capture date a camera got wrong
 * (the year 1 is not unknown) cannot make the loop run for millennia.
 */
export function memoryDays(today: Date, firstYear: number, span = 200): Day[] {
  const month = today.getUTCMonth();
  const date = today.getUTCDate();
  const thisYear = today.getUTCFullYear();
  const out: Day[] = [];
  for (let year = thisYear - 1; year >= Math.max(firstYear, thisYear - span); year--) {
    const start = new Date(Date.UTC(year, month, date));
    if (start.getUTCMonth() !== month || start.getUTCDate() !== date) continue;
    const end = new Date(start.getTime() + 86_400_000);
    out.push({ year, start: start.toISOString(), end: end.toISOString() });
  }
  return out;
}

export interface MemoryPost {
  id: string;
  author_id: string;
  taken_at: string;
  location: string | null;
}

export interface Memory {
  id: string;
  yearsAgo: number;
  place: string | null;
}

/**
 * One memory per member: of their photographs taken on this day in an
 * earlier year, the furthest back. Rows from any year, in any order.
 */
export function pickMemories(rows: MemoryPost[], today: Date): Map<string, Memory> {
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  const year = today.getUTCFullYear();
  const byMember = new Map<string, Memory>();
  for (const p of rows) {
    const d = new Date(p.taken_at);
    if (d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) continue;
    const yearsAgo = year - d.getUTCFullYear();
    if (yearsAgo < 1) continue;
    const prev = byMember.get(p.author_id);
    if (!prev || yearsAgo > prev.yearsAgo) {
      byMember.set(p.author_id, { id: p.id, yearsAgo, place: p.location?.trim() || null });
    }
  }
  return byMember;
}
