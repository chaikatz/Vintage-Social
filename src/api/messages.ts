import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import { fetchPost } from "./posts";
import type { ConversationWithPeer, MessageRow, MessageWithPost, ProfileRow } from "@/types/db";

/**
 * Direct messages: one to one, nothing else.
 *
 * There are no groups, no broadcasts and no requests folder — a member you
 * can see is a member you can write to, and a conversation is just the two
 * of you. A message carries words, a shared photograph, or both.
 */

/** The inbox, newest thread first. */
export async function fetchConversations(userId: string): Promise<ConversationWithPeer[]> {
  if (isDemoMode()) return demo.demoFetchConversations(userId);

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order("last_message_at", { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const peerIds = rows.map((c) => (c.user_a === userId ? c.user_b : c.user_a));
  const [{ data: peers }, { data: messages }] = await Promise.all([
    supabase.from("profiles").select("id, username, full_name, avatar_url").in("id", peerIds),
    supabase
      .from("messages")
      .select("*")
      .in("conversation_id", rows.map((c) => c.id))
      .order("created_at", { ascending: true }),
  ]);

  const byId = new Map((peers ?? []).map((p) => [p.id, p]));
  return rows.map((c) => {
    const peerId = c.user_a === userId ? c.user_b : c.user_a;
    const mine = (messages ?? []).filter((m) => m.conversation_id === c.id);
    return {
      ...c,
      peer: byId.get(peerId) ?? { id: peerId, username: "someone", full_name: null, avatar_url: null },
      last_message: mine.length ? mine[mine.length - 1] : null,
      unread_count: mine.filter((m) => m.sender_id !== userId && !m.read_at).length,
    };
  });
}

/** How many unread messages are waiting, for the badge on the tab bar. */
export async function fetchUnreadMessageCount(userId: string): Promise<number> {
  if (isDemoMode()) return demo.demoUnreadMessageCount(userId);
  const conversations = await fetchConversations(userId);
  return conversations.reduce((n, c) => n + c.unread_count, 0);
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

export async function fetchMessages(conversationId: string): Promise<MessageWithPost[]> {
  if (isDemoMode()) return demo.demoFetchMessages(conversationId);

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as MessageRow[];
  // Shared photographs are rare enough that fetching them individually is
  // cheaper than joining every message against posts.
  const shared = await Promise.all(
    rows.map((m) => (m.post_id ? fetchPost(m.post_id) : Promise.resolve(null))),
  );
  return rows.map((m, i) => ({ ...m, post: shared[i] }));
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
