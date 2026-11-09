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
  /**
   * Each notice Expo took, by its ticket: whether it reached the device is
   * known only later, from its receipt (checkReceipts).
   */
  tickets: Ticket[];
}

/** A notice Expo has taken: its ticket id, and the token it was for. */
export interface Ticket {
  id: string;
  token: string;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * A fetch that gives up after `ms`: the request is aborted and the promise
 * rejects, as a dropped connection would. A signal the caller passes is
 * still honoured. For the database client, whose requests had none.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function withDeadline(fetch: FetchLike, ms: number): FetchLike {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const outer = init.signal;
    const onAbort = () => controller.abort();
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener("abort", onAbort, { once: true });
    }
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    }
  };
}

/** POST JSON with a deadline; null when it fails or the deadline passes. */
async function postJson(fetch: Fetch, url: string, body: unknown, timeoutMs: number): Promise<Response | null> {
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
}

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
  const result: SendResult = { sent: 0, failed: 0, dead: [], tickets: [] };
  const batches: Message[][] = [];
  for (let i = 0; i < messages.length; i += batch) batches.push(messages.slice(i, i + batch));

  const post = (body: Message[]) => postJson(fetch, url, body, timeoutMs);

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
    let tickets: { status?: string; id?: string; details?: { error?: string } }[] = [];
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
        if (typeof ticket.id === "string" && ticket.id) result.tickets.push({ id: ticket.id, token: message.to });
        return;
      }
      result.failed++;
      if (ticket?.details?.error === "DeviceNotRegistered") result.dead.push(message.to);
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// receipts: which devices turned out to be gone
// ---------------------------------------------------------------------------

/** Expo answers at most this many receipt ids a request (its own SDK's chunk). */
export const RECEIPTS_PER_REQUEST = 300;

export interface ReceiptResult {
  /** Ticket ids Expo answered for, whatever the answer. */
  answered: string[];
  /** Ticket ids whose device Apple or Google says is gone (DeviceNotRegistered). */
  dead: string[];
}

/**
 * Ask Expo how the notices behind these tickets went. A ticket says only
 * that Expo took a notice; whether Apple or Google could deliver it comes
 * later, in its receipt (Expo keeps them for a day and suggests asking
 * fifteen minutes on), and that is where a device that has gone away is
 * first reported. Three hundred ids a request, a few at once, each with a
 * deadline. Never throws: a receipt that cannot be read is simply not
 * answered, and the token it was for is kept.
 */
export async function checkReceipts(
  ids: string[],
  {
    fetch,
    url = "https://exp.host/--/api/v2/push/getReceipts",
    timeoutMs = EXPO_TIMEOUT_MS,
    batch = RECEIPTS_PER_REQUEST,
    atOnce = EXPO_AT_ONCE,
  }: { fetch: Fetch; url?: string; timeoutMs?: number; batch?: number; atOnce?: number },
): Promise<ReceiptResult> {
  const result: ReceiptResult = { answered: [], dead: [] };
  await eachChunk(chunk(ids, batch), atOnce, async (part) => {
    const res = await postJson(fetch, url, { ids: part }, timeoutMs);
    if (!res || !res.ok) return;
    let receipts: Record<string, { status?: string; details?: { error?: string } }> = {};
    try {
      const parsed = (await res.json()) as { data?: typeof receipts };
      receipts = parsed?.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : {};
    } catch {
      receipts = {};
    }
    for (const id of part) {
      const receipt = receipts[id];
      if (!receipt) continue;
      result.answered.push(id);
      if (receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered") result.dead.push(id);
    }
  });
  return result;
}

/** A ticket as push_tickets keeps it (0027): also when its notice was sent, by the database's clock. */
export interface KeptTicket extends Ticket {
  created_at: string;
}

/**
 * The tokens of devices a receipt says are gone, each with when the last
 * notice found undeliverable was sent to it. A receipt describes the
 * device as it was when the notice reached Apple or Google, not as it is
 * now: a row filed again since (push_tokens.updated_at after that time)
 * is a phone that came back, or one another member has signed in on
 * since (claim_push_token, 0036, moves the row to them and dates it), and
 * must be kept. So the row goes only if it was not filed after the notice.
 */
export function goneTokens(tickets: readonly KeptTicket[], dead: Iterable<string>): Map<string, string> {
  const deadIds = new Set(dead);
  const out = new Map<string, string>();
  for (const t of tickets) {
    if (!deadIds.has(t.id)) continue;
    const kept = out.get(t.token);
    if (kept === undefined || Date.parse(t.created_at) > Date.parse(kept)) out.set(t.token, t.created_at);
  }
  return out;
}

// ---------------------------------------------------------------------------
// long lists, a page at a time
// ---------------------------------------------------------------------------

/**
 * Every key of a long list, a page at a time, each page asked for as "the
 * next `size` after the last key of the page before" (keyset paging), so
 * no page re-reads the ones before it as an offset would. Each page is
 * handed to `onPage` before the next is read, so memory stays one page
 * deep. Stops at a short page, at a page that could not be read (null),
 * or after `max` keys.
 */
export async function eachPageByKey<K>(
  readPage: (after: K | null, size: number) => Promise<K[] | null>,
  onPage: (keys: K[]) => Promise<void>,
  { size, max }: { size: number; max: number },
): Promise<{ read: number; complete: boolean }> {
  let after: K | null = null;
  let read = 0;
  for (;;) {
    const want = Math.min(size, max - read);
    if (want <= 0) return { read, complete: false };
    const keys = await readPage(after, want);
    if (keys === null) return { read, complete: false };
    read += keys.length;
    if (keys.length > 0) await onPage(keys);
    if (keys.length < want) return { read, complete: true };
    after = keys[keys.length - 1];
  }
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

// ---------------------------------------------------------------------------
// who may call the function
// ---------------------------------------------------------------------------

/**
 * The header only the database's push_event sends (0040), holding the push
 * hook's secret (app_settings.push_hook.secret), which the database makes
 * and keeps, and the function reads there (`HookSecret`).
 */
export const PUSH_SECRET_HEADER = "x-push-secret";

/**
 * Whether a call is the database's own: its x-push-secret header is the
 * secret the function holds. The platform's JWT check admits anyone with
 * the anon key, which every copy of the app carries, so it says nothing
 * about who is calling. With no secret held, nothing is admitted: a
 * function that cannot tell its caller sends nothing rather than anything
 * to anyone. Compared in constant time.
 */
export function isDatabaseCaller(given: string | null | undefined, held: string | null | undefined): boolean {
  if (!held || !given) return false;
  if (given.length !== held.length) return false;
  let diff = 0;
  for (let i = 0; i < held.length; i++) diff |= given.charCodeAt(i) ^ held.charCodeAt(i);
  return diff === 0;
}

/**
 * The push hook's secret, as the function holds it (0040). The database
 * makes it and keeps it in app_settings.push_hook; the function reads it
 * there with its service key (`read`), keeps it a while, and reads it
 * again when it is old, or, no more than once in a while, when a call's
 * does not match (the hook rewritten since). A call with no secret at all
 * reads nothing. Calls that arrive together share one read. A read that
 * fails (a timeout, the API busy) keeps what was held: a blip must not
 * turn the database's own calls away, and none of them is ever sent
 * again. There is one place the secret lives, the database; nothing set
 * on the function stands in for it.
 */
export class HookSecret {
  private held = "";
  private readAt = Number.NEGATIVE_INFINITY;
  private lastReadFailed = false;
  private reading: Promise<void> | null = null;

  constructor(
    /** The hook's secret as stored; throws when it could not be read. */
    private readonly read: () => Promise<unknown>,
    private readonly now: () => number = Date.now,
    private readonly keptMs = 10 * 60_000,
    private readonly againMs = 15_000,
  ) {}

  private refresh(): Promise<void> {
    if (!this.reading) {
      this.reading = (async () => {
        try {
          const secret = await this.read();
          this.held = typeof secret === "string" ? secret : "";
          this.lastReadFailed = false;
        } catch {
          // Not read: what was held stays.
          this.lastReadFailed = true;
        }
        this.readAt = this.now();
      })().finally(() => {
        this.reading = null;
      });
    }
    return this.reading;
  }

  /** Whether a call carrying `given` in its x-push-secret header is the database's. */
  async admits(given: string | null | undefined): Promise<boolean> {
    if (!given) return false;
    if (this.now() - this.readAt >= this.keptMs) await this.refresh();
    if (isDatabaseCaller(given, this.held)) return true;
    if (this.now() - this.readAt < this.againMs) return false;
    await this.refresh();
    return isDatabaseCaller(given, this.held);
  }

  /** Why every call is being refused, if one is: the hook has no secret, or it could not be read. */
  get trouble(): "no secret" | "unreadable" | null {
    if (this.held) return null;
    if (this.readAt === Number.NEGATIVE_INFINITY) return null;
    return this.lastReadFailed ? "unreadable" : "no secret";
  }
}
