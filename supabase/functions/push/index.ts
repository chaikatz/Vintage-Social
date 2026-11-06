// VINTAGE · push
//
// One function, four doors:
//   { kind: "activity", id }  a new Activity row — like, comment, follow,
//                             follow request, tag, message, admin note
//   { kind: "post", id }      a new photograph — tell the people who follow
//                             its author
//   { kind: "report", id }    a report filed — tell the admins (0032)
//   { kind: "memories" }      once a day: one of a member's own photographs
//                             from this day in another year
//
// Called by database triggers (pg_net) with the project's anon key, so the
// platform's JWT check admits it. Everything it sends is checked against
// the recipient's preferences and stamped once: `activity.pushed_at`,
// `posts.notified_at`, and a per-day guard for memories. Calling it again
// with the same id sends nothing (a report: `reports.pushed_at`). Nothing here reads a phone's photo
// library; a memory is a post, by its capture date.
//
// Copy is kept quiet on purpose: a name and what happened, no exclamation
// marks, no "don't miss", no emoji.

//
// Built to hold up as the club grows (logic.ts holds the parts tested in
// tests/push-function.test.ts):
//   * Expo is given a hundred notices a request, a few requests at once,
//     each with a deadline; one Expo is too busy for is tried once more.
//   * A device Expo says is gone (DeviceNotRegistered) is forgotten: its
//     token row is deleted, as the phone deletes it on sign-out. A phone
//     that comes back registers again.
//   * Every `in` filter (preferences, tokens) goes a hundred ids a read,
//     because it rides in the URL; followers are read a thousand at a
//     time (PostgREST's max_rows), each page "the next thousand after the
//     last follower told" (follows_followers_by_id_idx, 0026), until there
//     are no more, up to MAX_FOLLOWERS_TOLD, so one post's fan-out is
//     bounded and no page re-reads the ones before it.
//   * Whether a notice reached the device is reported later, in Expo's
//     receipts, and that is where Apple or Google first says a device is
//     gone. Each notice Expo takes is noted (push_tickets, 0027); once a
//     day, after the memories, the receipts are asked for and the tokens
//     of devices that are gone are deleted.
//   * On This Day asks for photographs taken on today's date in each
//     earlier year (an index range each, posts_taken_idx in 0023) rather
//     than every dated photograph in the club, which past a thousand
//     PostgREST cut short and members silently missed their memory.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  checkReceipts,
  chunk,
  eachChunk,
  eachPageByKey,
  IDS_PER_READ,
  memoryDays,
  pickMemories,
  sendToExpo,
  withDeadline,
  type MemoryPost,
  type Message,
} from "./logic.ts";

const LIKE_QUIET_MINUTES = 30;
/** PostgREST hands back at most this many rows a read (max_rows). */
const ROWS_PER_READ = 1000;
/** The most followers one new photograph is announced to. */
const MAX_FOLLOWERS_TOLD = 50_000;
/** Receipts are asked for this long after sending, as Expo suggests. */
const RECEIPT_DELAY_MINUTES = 15;
/** The most receipts asked for in one daily run, so the run stays bounded. */
const MAX_RECEIPTS_A_RUN = 30_000;
/** Ticket rows written per insert. */
const TICKETS_PER_WRITE = 500;
/** How long one database request may take before it is given up on. */
const DB_TIMEOUT_MS = 10_000;

type Kind = "activity" | "post" | "report" | "memories";

interface Prefs {
  likes: boolean;
  comments: boolean;
  follows: boolean;
  tags: boolean;
  messages: boolean;
  posts: boolean;
  memories: boolean;
}

const DEFAULT_PREFS: Prefs = {
  likes: true,
  comments: true,
  follows: true,
  tags: true,
  messages: true,
  posts: true,
  memories: true,
};

// Every read and write of the database has a deadline too: one that hangs
// is given up on (supabase-js returns it as an error, which each caller
// already treats as nothing found), rather than holding the function
// until the platform stops it.
const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false }, global: { fetch: withDeadline((url, init) => fetch(url, init), DB_TIMEOUT_MS) } },
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let payload: { kind?: Kind; id?: string | null };
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  try {
    switch (payload.kind) {
      case "activity":
        return json(await handleActivity(String(payload.id ?? "")));
      case "post":
        return json(await handlePost(String(payload.id ?? "")));
      case "report":
        return json(await handleReport(String(payload.id ?? "")));
      case "memories":
        return json(await handleMemories());
      default:
        return new Response("Unknown kind", { status: 400 });
    }
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// who hears what
// ---------------------------------------------------------------------------

async function prefsFor(userIds: string[]): Promise<Map<string, Prefs>> {
  const out = new Map<string, Prefs>();
  for (const id of userIds) out.set(id, DEFAULT_PREFS);
  if (userIds.length === 0) return out;
  // A hundred members a read: the ids ride in the URL. A read that fails
  // leaves those members on the defaults, as one failed read always did.
  await eachChunk(chunk(userIds, IDS_PER_READ), 4, async (ids) => {
    const { data } = await admin.from("notification_prefs").select("*").in("user_id", ids);
    for (const row of data ?? []) out.set(row.user_id, row as Prefs);
  });
  return out;
}

async function tokensFor(userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  await eachChunk(chunk(userIds, IDS_PER_READ), 4, async (ids) => {
    const { data } = await admin
      .from("push_tokens")
      .select("token, user_id")
      .in("user_id", ids)
      .is("invalid_at", null);
    for (const row of data ?? []) {
      const list = out.get(row.user_id) ?? [];
      list.push(row.token);
      out.set(row.user_id, list);
    }
  });
  return out;
}

/** A member's display name, the way the app shows it. */
async function nameOf(userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("username, full_name").eq("id", userId).maybeSingle();
  return data?.username ?? "Someone";
}

// ---------------------------------------------------------------------------
// the doors
// ---------------------------------------------------------------------------

async function handleActivity(id: string): Promise<unknown> {
  if (!id) return { sent: 0, reason: "no id" };
  // Claim the row first: whoever flips pushed_at from null sends; a second
  // call finds it set and stops.
  const { data: claimed } = await admin
    .from("activity")
    .update({ pushed_at: new Date().toISOString() })
    .eq("id", id)
    .is("pushed_at", null)
    .select("*")
    .maybeSingle();
  if (!claimed) return { sent: 0, reason: "already sent or unknown" };

  const recipient = claimed.recipient_id as string;
  const actor = claimed.actor_id as string | null;
  const type = claimed.type as string;
  const prefs = (await prefsFor([recipient])).get(recipient) ?? DEFAULT_PREFS;

  const who = actor ? await nameOf(actor) : null;
  let title: string | undefined;
  let body: string;
  const data: Record<string, string> = { kind: type };
  if (claimed.post_id) data.postId = String(claimed.post_id);
  if (actor) data.actorId = actor;

  switch (type) {
    case "like": {
      if (!prefs.likes) return { sent: 0, reason: "muted" };
      // A run of likes reads as one. If this member was told about a like
      // in the last half hour, the rest wait for them in Activity.
      // One such row is enough to know: no exact count of a popular
      // member's likes, just whether there is one.
      // Bounded by when the rows were made, too, so the read is a range
      // of activity_recipient_idx (recipient, newest first) that ends an
      // hour back, rather than every Activity row the member has ever
      // had, which is what it read whenever no recent like was found (the
      // usual case). A like is pushed seconds after it is made; the hour
      // leaves room for one whose push was held up for half an hour.
      const since = new Date(Date.now() - LIKE_QUIET_MINUTES * 60_000).toISOString();
      const madeSince = new Date(Date.now() - 2 * LIKE_QUIET_MINUTES * 60_000).toISOString();
      const { data: recent } = await admin
        .from("activity")
        .select("id")
        .eq("recipient_id", recipient)
        .gte("created_at", madeSince)
        .eq("type", "like")
        .neq("id", id)
        .gte("pushed_at", since)
        .limit(1);
      if ((recent ?? []).length > 0) return { sent: 0, reason: "quiet" };
      body = `${who} liked your photograph.`;
      break;
    }
    case "comment": {
      if (!prefs.comments) return { sent: 0, reason: "muted" };
      let excerpt = "";
      if (claimed.comment_id) {
        const { data: c } = await admin.from("comments").select("body").eq("id", claimed.comment_id).maybeSingle();
        excerpt = (c?.body ?? "").trim();
      }
      title = who ?? undefined;
      body = excerpt ? `“${excerpt.length > 120 ? excerpt.slice(0, 117) + "…" : excerpt}”` : `${who} commented on your photograph.`;
      break;
    }
    case "follow":
      if (!prefs.follows) return { sent: 0, reason: "muted" };
      body = `${who} is following you.`;
      if (who) data.username = who;
      break;
    case "follow_request":
      if (!prefs.follows) return { sent: 0, reason: "muted" };
      body = `${who} asked to follow you.`;
      data.route = "/requests";
      break;
    case "tag":
      if (!prefs.tags) return { sent: 0, reason: "muted" };
      body = `${who} put you in a photograph.`;
      data.route = "/(tabs)/activity";
      break;
    case "message":
      if (!prefs.messages) return { sent: 0, reason: "muted" };
      body = `${who} sent you a message.`;
      data.route = "/messages";
      break;
    case "moderation":
      // Membership notes are worth hearing; nothing else from admins is pushed.
      if (!/^Welcome to VINTAGE|invitation/i.test(String(claimed.message ?? ""))) {
        return { sent: 0, reason: "admin note" };
      }
      body = String(claimed.message);
      data.route = "/(tabs)/activity";
      break;
    default:
      return { sent: 0, reason: "unknown type" };
  }

  const tokens = (await tokensFor([recipient])).get(recipient) ?? [];
  return send(tokens.map((to) => ({ to, title, body, data, sound: "default" })));
}

async function handlePost(id: string): Promise<unknown> {
  if (!id) return { sent: 0, reason: "no id" };
  const { data: post } = await admin
    .from("posts")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", id)
    .is("notified_at", null)
    .is("removed_at", null)
    .select("id, author_id, location, media_type")
    .maybeSingle();
  if (!post) return { sent: 0, reason: "already sent or unknown" };

  const { data: author } = await admin
    .from("profiles")
    .select("username, is_house")
    .eq("id", post.author_id)
    .maybeSingle();
  // The house accounts are furniture; nobody is woken for them.
  if (!author || author.is_house) return { sent: 0, reason: "house" };

  const what = post.media_type === "video" ? "a short film" : "a photograph";
  const place = (post.location ?? "").trim();
  const body = place ? `${author.username} posted ${what} from ${place}.` : `${author.username} posted ${what}.`;

  // Followers a page at a time (PostgREST stops at max_rows), each page
  // told before the next is read, so memory stays one page deep. Each
  // page is the next thousand after the last follower told, in follower
  // order (keyset, follows_followers_by_id_idx): pages neither overlap
  // nor skip, and none re-reads the ones before it, as an offset did.
  const total = { sent: 0, failed: 0, followers: 0 };
  const { complete } = await eachPageByKey<string>(
    async (after, size) => {
      let query = admin
        .from("follows")
        .select("follower_id")
        .eq("followee_id", post.author_id)
        .eq("status", "accepted");
      if (after !== null) query = query.gt("follower_id", after);
      const { data: page, error } = await query.order("follower_id", { ascending: true }).limit(size);
      if (error) return null;
      return (page ?? []).map((f) => f.follower_id as string);
    },
    async (ids) => {
      total.followers += ids.length;
      const prefs = await prefsFor(ids);
      const wanted = ids.filter((uid) => (prefs.get(uid) ?? DEFAULT_PREFS).posts);
      const tokens = await tokensFor(wanted);
      const messages: Message[] = [];
      for (const uid of wanted) {
        for (const to of tokens.get(uid) ?? []) {
          messages.push({ to, body, data: { kind: "post", postId: post.id }, sound: null });
        }
      }
      const result = await send(messages);
      total.sent += result.sent;
      total.failed += result.failed;
    },
    { size: ROWS_PER_READ, max: MAX_FOLLOWERS_TOLD },
  );
  if (!complete && total.followers >= MAX_FOLLOWERS_TOLD) {
    console.warn(`post ${post.id}: told the first ${MAX_FOLLOWERS_TOLD} followers and stopped`);
  }
  if (total.followers === 0) return { sent: 0, reason: "no followers" };
  return { sent: total.sent, failed: total.failed };
}

/**
 * A report has been filed: the admins are told, so the 24 hours the Terms
 * promise start with someone knowing. Claimed once, as an Activity row is
 * (reports.pushed_at, 0032), and only while the report is open. The
 * notice says nothing of what was reported or by whom: a lock screen is
 * not the place for it, and the Reports screen is where the work is. Every
 * approved admin's devices are told, whatever their other preferences
 * (there is no setting for this; it is the job). An admin with no device
 * registered is not reached here.
 */
async function handleReport(id: string): Promise<unknown> {
  if (!id) return { sent: 0, reason: "no id" };
  const { data: claimed } = await admin
    .from("reports")
    .update({ pushed_at: new Date().toISOString() })
    .eq("id", id)
    .is("pushed_at", null)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (!claimed) return { sent: 0, reason: "already sent or unknown" };

  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("status", "approved")
    .limit(ROWS_PER_READ);
  const ids = (admins ?? []).map((a) => a.id as string);
  if (ids.length === 0) return { sent: 0, reason: "no admins" };

  const tokens = await tokensFor(ids);
  const messages: Message[] = [];
  for (const uid of ids) {
    for (const to of tokens.get(uid) ?? []) {
      messages.push({ to, body: "A report is waiting.", data: { kind: "report", route: "/admin/reports" }, sound: "default" });
    }
  }
  return send(messages);
}

/**
 * "3 years ago today, you were in St. Barths."
 *
 * One per member per day: the oldest of their own photographs taken on
 * this calendar day in an earlier year, by capture date. Only members who
 * have not been told today; the guard is a row in app_settings keyed by
 * the day, so a second run the same day sends nothing.
 */
async function handleMemories(): Promise<unknown> {
  const today = new Date();
  const dayKey = today.toISOString().slice(0, 10);
  const { data: guard } = await admin
    .from("app_settings")
    .upsert({ key: `memories_sent:${dayKey}`, value: { started: new Date().toISOString() } }, { onConflict: "key", ignoreDuplicates: true })
    .select("key");
  if (!guard || guard.length === 0) return { sent: 0, reason: "already ran today" };

  const memories = await sendMemories(today);
  // Once a day, after the day's memories are out, whether or not there
  // were any: which devices turned out to be gone.
  const receipts = await settleReceipts().catch((err) => {
    console.error("receipts", err);
    return { asked: 0, gone: 0 };
  });
  return { ...memories, receipts };
}

/** Today's memories, one per member, to those who want them. */
async function sendMemories(today: Date): Promise<Record<string, unknown>> {
  // Posts whose capture date falls on this month/day in an earlier year:
  // one small range read per year (posts_taken_idx), back to the oldest
  // dated photograph in the club, each paged past max_rows. It used to
  // read every dated photograph in the club and keep today's, and
  // PostgREST stopped at a thousand without saying which.
  const { data: oldest } = await admin
    .from("posts")
    .select("taken_at")
    .not("taken_at", "is", null)
    .is("removed_at", null)
    .order("taken_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!oldest?.taken_at) return { sent: 0, reason: "nothing today" };
  const days = memoryDays(today, new Date(oldest.taken_at as string).getUTCFullYear());
  const found = await eachChunk(days.map((d) => [d]), 4, async ([d]) => {
    const rows: MemoryPost[] = [];
    for (let from = 0; ; from += ROWS_PER_READ) {
      const { data: page } = await admin
        .from("posts")
        .select("id, author_id, taken_at, location")
        .is("removed_at", null)
        .gte("taken_at", d.start)
        .lt("taken_at", d.end)
        .order("taken_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + ROWS_PER_READ - 1);
      rows.push(...((page ?? []) as MemoryPost[]));
      if ((page ?? []).length < ROWS_PER_READ) break;
    }
    return rows;
  });
  // The furthest back is the one worth a word.
  const byMember = pickMemories(found.flat(), today);
  const members = [...byMember.keys()];
  if (members.length === 0) return { sent: 0, reason: "nothing today" };

  const prefs = await prefsFor(members);
  const wanted = members.filter((uid) => (prefs.get(uid) ?? DEFAULT_PREFS).memories);
  const tokens = await tokensFor(wanted);
  const messages: Message[] = [];
  for (const uid of wanted) {
    const m = byMember.get(uid)!;
    const when = m.yearsAgo === 1 ? "1 year ago today" : `${m.yearsAgo} years ago today`;
    const body = m.place ? `${when}, you were in ${m.place}.` : `${when}.`;
    for (const to of tokens.get(uid) ?? []) {
      messages.push({ to, title: "On this day", body, data: { kind: "memory", postId: m.id, route: "/memories" }, sound: null });
    }
  }
  return send(messages);
}

/**
 * Ask Expo for the receipts of the notices sent since the last run (at
 * least fifteen minutes ago), delete the tokens of devices Apple or
 * Google says are gone, and let go of the tickets. Expo keeps receipts
 * for a day, and this runs once a day, so a ticket older than that is let
 * go unread; at most MAX_RECEIPTS_A_RUN are asked for, by ticket id.
 */
async function settleReceipts(): Promise<{ asked: number; gone: number }> {
  const before = new Date(Date.now() - RECEIPT_DELAY_MINUTES * 60_000).toISOString();
  let asked = 0;
  let gone = 0;
  await eachPageByKey<{ id: string; token: string }>(
    async (after, size) => {
      let query = admin.from("push_tickets").select("id, token").lt("created_at", before);
      if (after !== null) query = query.gt("id", after.id);
      const { data, error } = await query.order("id", { ascending: true }).limit(size);
      if (error) return null;
      return (data ?? []) as { id: string; token: string }[];
    },
    async (tickets) => {
      asked += tickets.length;
      const { dead } = await checkReceipts(tickets.map((t) => t.id), { fetch: (url, init) => fetch(url, init) });
      const deadIds = new Set(dead);
      const tokens = tickets.filter((t) => deadIds.has(t.id)).map((t) => t.token);
      for (const part of chunk(tokens, IDS_PER_READ)) {
        await admin.from("push_tokens").delete().in("token", part);
        gone += part.length;
      }
    },
    { size: ROWS_PER_READ, max: MAX_RECEIPTS_A_RUN },
  );
  // Read or not, a ticket older than the delay has had its one chance.
  await admin.from("push_tickets").delete().lt("created_at", before);
  return { asked, gone };
}

// ---------------------------------------------------------------------------
// through Expo, in chunks; dead devices are forgotten
// ---------------------------------------------------------------------------

async function send(messages: Message[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };
  const { sent, failed, dead, tickets } = await sendToExpo(messages, { fetch: (url, init) => fetch(url, init) });
  // A device that is gone will not come back under this token; the row
  // goes, a hundred tokens a delete (they ride in the URL).
  for (const tokens of chunk(dead, IDS_PER_READ)) {
    await admin.from("push_tokens").delete().in("token", tokens);
  }
  // Each notice Expo took, for its receipt at the next daily run
  // (settleReceipts). Best effort: a ticket not kept is a receipt unread.
  for (let i = 0; i < tickets.length; i += TICKETS_PER_WRITE) {
    await admin.from("push_tickets").insert(tickets.slice(i, i + TICKETS_PER_WRITE));
  }
  return { sent, failed };
}
