import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import { POST_WITH_AUTHOR } from "./posts";
import { readInChunks } from "./batch";
import { ROWS_PER_READ } from "@/utils/eraEdits";
import type {
  ConversationRow,
  ConversationWithPeer,
  MessageRow,
  MessageWithPost,
  PostWithAuthor,
  ProfileRow,
} from "@/types/db";

/**
 * Direct messages: one to one, nothing else.
 *
 * There are no groups, no broadcasts and no requests folder — a member you
 * can see is a member you can write to, and a conversation is just the two
 * of you. A message carries words, a shared photograph, or both.
 */

/**
 * The inbox, newest thread first: each thread with the member on the
 * other end, its newest message, and how many of the other member's
 * messages are unread.
 *
 * It used to read every message of every thread to find those two
 * things - the whole of a member's correspondence, on every open of the
 * inbox and every refresh of the badge on the feed - and PostgREST stops
 * at max_rows (1000) without saying so, oldest first: past a thousand
 * messages the "newest" message shown was an old one and new messages
 * were not counted as unread. Now each thread brings only its newest
 * message (an embedded resource's order and limit apply per thread), and
 * the unread count reads only the unread messages, a hundred threads a
 * request (./batch).
 */
export async function fetchConversations(userId: string): Promise<ConversationWithPeer[]> {
  if (isDemoMode()) return demo.demoFetchConversations(userId);

  const { data, error } = await supabase
    .from("conversations")
    .select("*, messages!messages_conversation_id_fkey(*)")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" });
  if (error) throw error;

  const rows = (data ?? []) as unknown as (ConversationRow & { messages: MessageRow[] | null })[];
  if (rows.length === 0) return [];

  const peerIds = rows.map((c) => (c.user_a === userId ? c.user_b : c.user_a));
  const [peers, unread] = await Promise.all([
    readInChunks(peerIds, async (chunk) => {
      const { data: found, error: peersError } = await supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url")
        .in("id", chunk);
      if (peersError) throw peersError;
      return (found ?? []) as ConversationWithPeer["peer"][];
    }).catch(() => [] as ConversationWithPeer["peer"][]),
    readInChunks(rows.map((c) => c.id), async (chunk) => {
      const { data: waiting, error: unreadError } = await supabase
        .from("messages")
        .select("conversation_id")
        .in("conversation_id", chunk)
        .is("read_at", null)
        .neq("sender_id", userId);
      if (unreadError) throw unreadError;
      return (waiting ?? []) as { conversation_id: string }[];
    }).catch(() => [] as { conversation_id: string }[]),
  ]);

  const byId = new Map(peers.map((p) => [p.id, p]));
  const unreadIn = new Map<string, number>();
  for (const m of unread) unreadIn.set(m.conversation_id, (unreadIn.get(m.conversation_id) ?? 0) + 1);
  return rows.map(({ messages, ...c }) => {
    const peerId = c.user_a === userId ? c.user_b : c.user_a;
    return {
      ...c,
      peer: byId.get(peerId) ?? { id: peerId, username: "someone", full_name: null, avatar_url: null },
      last_message: messages?.[0] ?? null,
      unread_count: unreadIn.get(c.id) ?? 0,
    };
  });
}

/**
 * How many unread messages are waiting, for the badge on the tab bar.
 *
 * Only what the badge needs: the member's threads, by id, and the unread
 * messages others sent in them - the same count the inbox adds up, without
 * the inbox's newest message per thread and every peer's profile, which
 * the badge never shows and refreshes far more often than the inbox.
 */
export async function fetchUnreadMessageCount(userId: string): Promise<number> {
  if (isDemoMode()) return demo.demoUnreadMessageCount(userId);
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  if (error) throw error;
  const ids = (data ?? []).map((c) => c.id as string);
  if (ids.length === 0) return 0;
  const waiting = await readInChunks(ids, async (chunk) => {
    const { data: rows, error: unreadError } = await supabase
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", chunk)
      .is("read_at", null)
      .neq("sender_id", userId);
    if (unreadError) throw unreadError;
    return (rows ?? []) as { conversation_id: string }[];
  }).catch(() => [] as { conversation_id: string }[]);
  return waiting.length;
}

/**
 * The id of the thread with this member, opening one if they have never
 * spoken. The pair is stored in a fixed order, so whoever writes first, both
 * of them end up in the same conversation.
 */
export async function openConversation(userId: string, peerId: string): Promise<string> {
  if (isDemoMode()) return demo.demoOpenConversation(userId, peerId);

  const [a, b] = userId < peerId ? [userId, peerId] : [peerId, userId];
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_a", a)
    .eq("user_b", b)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_a: a, user_b: b })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * A thread, oldest first, with the photographs it carries.
 *
 * PostgREST stops at max_rows (1000, ROWS_PER_READ) without saying so,
 * and the thread used to be read oldest first: past a thousand messages
 * the newest - the one just sent, the one just received - were the ones
 * left out, and stayed out on every poll. It now reads the newest
 * thousand and turns them round: the same list whenever there are fewer.
 */
export async function fetchMessages(conversationId: string): Promise<MessageWithPost[]> {
  if (isDemoMode()) return demo.demoFetchMessages(conversationId);

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(ROWS_PER_READ);
  if (error) throw error;

  const rows = ((data ?? []) as MessageRow[]).reverse();
  // Shared photographs are rare enough that reading them on their own is
  // cheaper than joining every message against posts — and a thread is
  // re-read every few seconds while open, so each is read once and kept
  // for a while rather than fetched again on every poll. The ones not
  // already kept are read together, a hundred a request, rather than one
  // request each: a thread of shared photographs used to open with one
  // round trip per photograph.
  const shared = await sharedPostsFor(rows.map((m) => m.post_id).filter((id): id is string => Boolean(id)));
  return rows.map((m) => ({ ...m, post: m.post_id ? shared.get(m.post_id) : null }));
}

const SHARED_POST_TTL_MS = 5 * 60_000;
interface SharedRead {
  at: number;
  post: Promise<PostWithAuthor | null | undefined>;
  /** The server's last answer: undefined until it has given one. */
  known: PostWithAuthor | null | undefined;
}
const sharedPosts = new Map<string, SharedRead>();

/** Forget every kept photograph (tests, and a sign-out). */
export function forgetSharedPosts(): void {
  sharedPosts.clear();
}

/**
 * Each post, or null when the server answered without it (it has gone, or
 * the reader may not see it). A read that fails is not kept: no answer is
 * not taken for gone. It stands on the server's last answer, or undefined
 * if there has not been one, and the next poll asks again.
 */
async function sharedPostsFor(postIds: string[]): Promise<Map<string, PostWithAuthor | null | undefined>> {
  const now = Date.now();
  const toRead: { id: string; read: SharedRead; known: PostWithAuthor | null | undefined }[] = [];
  for (const id of new Set(postIds)) {
    const cached = sharedPosts.get(id);
    if (cached && now - cached.at < SHARED_POST_TTL_MS) continue;
    const known = cached?.known;
    const read: SharedRead = { at: now, post: Promise.resolve(known), known };
    sharedPosts.set(id, read);
    toRead.push({ id, read, known });
  }

  if (toRead.length > 0) {
    const answered = readInChunks(
      toRead.map((r) => r.id),
      async (chunk) => {
        const { data, error } = await supabase.from("posts").select(POST_WITH_AUTHOR).in("id", chunk);
        if (error) throw error;
        return (data ?? []) as unknown as PostWithAuthor[];
      },
    ).then(
      (posts) => new Map(posts.map((p) => [p.id, p])),
      () => null,
    );
    for (const r of toRead) {
      r.read.post = answered.then((found) => {
        if (found) {
          const post = found.get(r.id) ?? null;
          r.read.known = post;
          return post;
        }
        if (sharedPosts.get(r.id) === r.read) {
          if (r.known === undefined) sharedPosts.delete(r.id);
          else r.read.at = 0;
        }
        return r.known;
      });
    }
  }

  const out = new Map<string, PostWithAuthor | null | undefined>();
  await Promise.all(
    [...new Set(postIds)].map(async (id) => {
      out.set(id, await (sharedPosts.get(id)?.post ?? Promise.resolve(undefined)));
    }),
  );
  return out;
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string,
  postId: string | null = null,
): Promise<void> {
  if (!body.trim() && !postId) return;
  if (isDemoMode()) {
    demo.demoSendMessage(conversationId, senderId, body, postId);
    return;
  }
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: senderId,
    body: body.trim(),
    post_id: postId,
  });
  if (error) throw error;
}

/** Send one photograph to several members at once, from the share sheet. */
export async function sharePostWith(
  senderId: string,
  peerIds: string[],
  postId: string,
  note: string,
): Promise<void> {
  for (const peerId of peerIds) {
    const conversationId = await openConversation(senderId, peerId);
    await sendMessage(conversationId, senderId, note, postId);
  }
}

export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoMarkConversationRead(conversationId, userId);
    return;
  }
  const { error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_id", userId)
    .is("read_at", null);
  if (error) throw error;
}

export async function fetchConversationPeer(
  conversationId: string,
  userId: string,
): Promise<ProfileRow | null> {
  if (isDemoMode()) return demo.demoConversationPeer(conversationId, userId);

  const { data } = await supabase
    .from("conversations")
    .select("user_a, user_b")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) return null;
  const peerId = data.user_a === userId ? data.user_b : data.user_a;
  const { data: peer } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", peerId)
    .maybeSingle();
  return (peer as ProfileRow) ?? null;
}
