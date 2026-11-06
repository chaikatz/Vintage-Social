import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import { forgetFollowingIds } from "./posts";
import { readInChunks } from "./batch";
import { demoKeysetPage, pageAfter, type Cursor } from "./keyset";
import type { FollowStatus, ProfileRow } from "@/types/db";

export async function fetchProfileByUsername(username: string): Promise<ProfileRow | null> {
  if (isDemoMode()) return demo.demoFetchProfileByUsername(username);

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

export async function fetchProfileById(id: string): Promise<ProfileRow | null> {
  if (isDemoMode()) return demo.demoFetchProfileById(id);

  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

/** Plain prefix/substring search over usernames and names. No suggestions. */
export async function searchProfiles(q: string): Promise<ProfileRow[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  if (isDemoMode()) return demo.demoSearchProfiles(needle);

  const escaped = needle.replace(/[%_\\]/g, "\\$&").replace(/,/g, "");
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("status", "approved")
    .or(`username.ilike.%${escaped}%,full_name.ilike.%${escaped}%`)
    .order("username")
    .limit(30);
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

export interface ProfileEdits {
  full_name?: string;
  bio?: string;
  avatar_url?: string;
  city?: string;
  is_private?: boolean;
}

export async function updateOwnProfile(userId: string, edits: ProfileEdits): Promise<void> {
  if (isDemoMode()) {
    demo.demoUpdateProfile(userId, edits);
    return;
  }
  const { error } = await supabase.from("profiles").update(edits).eq("id", userId);
  if (error) throw error;
}

/**
 * Where a follow stands: accepted, waiting on a private member, or absent.
 */
export async function followState(
  followerId: string,
  followeeId: string,
): Promise<FollowStatus | null> {
  if (isDemoMode()) return demo.demoFollowState(followerId, followeeId);

  const { data, error } = await supabase
    .from("follows")
    .select("status")
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId)
    .maybeSingle();
  if (error) throw error;
  return (data?.status as FollowStatus) ?? null;
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  return (await followState(followerId, followeeId)) === "accepted";
}

/**
 * Follow a member. Following a private member files a request instead —
 * the returned status says which happened, so the button can read
 * "Requested" rather than pretending it worked.
 *
 * The database decides the status from the followee (migration 0038),
 * whatever is sent; the status sent here is for a database without it.
 * So a read of the followee that fails stops the follow, rather than
 * filing it as accepted (a private account's photographs opened to
 * someone it never let in), and the button is labelled with the status
 * the database stored: the row the insert returns, or, when the follow
 * was there already, a read of it.
 */
export async function follow(followerId: string, followeeId: string): Promise<FollowStatus> {
  if (isDemoMode()) return demo.demoFollow(followerId, followeeId);

  const { data: target, error: readError } = await supabase
    .from("profiles")
    .select("is_private")
    .eq("id", followeeId)
    .maybeSingle();
  if (readError) throw readError;
  const asked: FollowStatus = target?.is_private ? "pending" : "accepted";
  const { data: stored, error } = await supabase
    .from("follows")
    .insert({ follower_id: followerId, followee_id: followeeId, status: asked })
    .select("status")
    .maybeSingle();
  if (error && error.code !== "23505") throw error;
  forgetFollowingIds(followerId);
  if (stored?.status) return stored.status as FollowStatus;
  return (await followState(followerId, followeeId)) ?? asked;
}

/**
 * A private member accepting or declining a request that is waiting on
 * them. Each asks for the row it changed back: row-level security turns
 * a change it does not allow into a change of nothing, with no error,
 * and the database before migration 0038 allowed the followee neither,
 * so a decision that changed no row is said to have failed (the request
 * goes back on the list) rather than taken for done.
 */
export async function decideFollowRequest(
  followerId: string,
  followeeId: string,
  accept: boolean,
): Promise<void> {
  if (isDemoMode()) {
    demo.demoDecideFollowRequest(followerId, followeeId, accept);
    return;
  }
  // Declining removes the row outright rather than leaving a rejected
  // record around — a request that was turned down can simply be made again.
  const rows = supabase.from("follows");
  const { data, error } = accept
    ? await rows
        .update({ status: "accepted" })
        .eq("follower_id", followerId)
        .eq("followee_id", followeeId)
        .eq("status", "pending")
        .select("follower_id")
    : await rows
        .delete()
        .eq("follower_id", followerId)
        .eq("followee_id", followeeId)
        .eq("status", "pending")
        .select("follower_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(REQUEST_NOT_DECIDED);
}

/** What a decision that changed nothing says (the request is put back on the list): the screen's own words for a refusal. */
export const REQUEST_NOT_DECIDED = "Nothing changed. Try again in a moment.";

/**
 * Members waiting on you to let them in, the newest request first. A
 * request whose member can no longer be read (a block since, say) comes
 * back without them, and is left out rather than drawn as an empty row.
 */
export async function fetchPendingRequests(followeeId: string): Promise<ProfileRow[]> {
  if (isDemoMode()) return demo.demoPendingRequests(followeeId);

  const { data, error } = await supabase
    .from("follows")
    .select("follower:profiles!follows_follower_id_fkey(*)")
    .eq("followee_id", followeeId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { follower: ProfileRow | null }[])
    .map((r) => r.follower)
    .filter((p): p is ProfileRow => p != null);
}

/** What a row of a list of members draws, and no more of their profile. */
export type MemberRow = Pick<ProfileRow, "id" | "username" | "full_name" | "avatar_url" | "city">;
const MEMBER_ROW = "id, username, full_name, avatar_url, city";

/** Members a page of followers or following brings. */
export const FOLLOWS_PAGE_SIZE = 50;

/** Where the next page of a follow list starts: the last follow on the page before. */
export type FollowCursor = Cursor;

export interface FollowPage {
  members: MemberRow[];
  /** Where the next page starts; none when this page ended the list. */
  next?: FollowCursor;
}

const SIDES = {
  // Who follows `userId`: their follows of them (follows_followers_idx).
  followers: { mine: "followee_id", theirs: "follower_id", fk: "follows_follower_id_fkey" },
  // Whom `userId` follows.
  following: { mine: "follower_id", theirs: "followee_id", fk: "follows_followee_id_fkey" },
} as const;

/**
 * A page of the members who follow `userId`, or whom they follow: the
 * newest follow first, FOLLOWS_PAGE_SIZE at a time, each page after the
 * last follow of the one before (./keyset), with only what a row draws.
 *
 * The lists were one read of every follow with every column of every
 * profile, and PostgREST stops a read at a thousand rows without saying
 * so: a member followed by more than that showed a thousand, and the rest
 * were nowhere. Accepted follows only; requests are not followers yet. A
 * follow whose member cannot be read (a block, say) is left out, and the
 * page still counts it, so it never ends the list early.
 *
 * A page whose every member is left out would come back with no member
 * and more to come, and a list holding no row reads as empty ("No
 * followers yet") while the rest waits unasked. So the next page is read
 * at once, up to HIDDEN_PAGES_READ_ON in one call, until one brings a
 * member or the list ends.
 */
export async function fetchFollowPage(
  side: keyof typeof SIDES,
  userId: string,
  before: FollowCursor | null,
): Promise<FollowPage> {
  if (isDemoMode()) {
    return demoPage(demo.demoFollowRows(userId, side), before);
  }

  let page = await readFollowPage(side, userId, before);
  for (let i = 1; i < HIDDEN_PAGES_READ_ON && page.members.length === 0 && page.next; i++) {
    page = await readFollowPage(side, userId, page.next);
  }
  return page;
}

/** Pages of nobody readable read through in one call of fetchFollowPage. */
const HIDDEN_PAGES_READ_ON = 10;

async function readFollowPage(side: keyof typeof SIDES, userId: string, before: FollowCursor | null): Promise<FollowPage> {
  const { mine, theirs, fk } = SIDES[side];
  const query = supabase
    .from("follows")
    .select(`created_at, ${theirs}, member:profiles!${fk}(${MEMBER_ROW})`)
    .eq(mine, userId)
    .eq("status", "accepted");
  const { data, error } = await pageAfter(query, "created_at", theirs, before)
    .order("created_at", { ascending: false })
    .order(theirs, { ascending: false })
    .limit(FOLLOWS_PAGE_SIZE);
  if (error) throw error;
  const rows = (data ?? []) as unknown as ({ created_at: string; member: MemberRow | null } & Record<string, unknown>)[];
  const last = rows[rows.length - 1];
  return {
    members: rows.map((r) => r.member).filter((m): m is MemberRow => m != null),
    next: rows.length < FOLLOWS_PAGE_SIZE ? undefined : { at: last.created_at, id: String(last[theirs]) },
  };
}

/** The demo's lists, in the server's order, a page at a time after the follow held last. */
function demoPage(all: { at: string; member: ProfileRow }[], before: FollowCursor | null): FollowPage {
  const page = demoKeysetPage(all, (r) => ({ at: r.at, id: r.member.id }), before, FOLLOWS_PAGE_SIZE);
  const members = page.map(({ member: { id, username, full_name, avatar_url, city } }) => ({ id, username, full_name, avatar_url, city }));
  const last = page[page.length - 1];
  return { members, next: page.length < FOLLOWS_PAGE_SIZE ? undefined : { at: last.at, id: last.member.id } };
}

/**
 * Where `followerId` stands with each of these members: following, asked,
 * or (absent from the answer) neither. Asked of the rows on screen, a
 * page at a time, not of every follow they have made.
 */
export async function fetchFollowStates(
  followerId: string,
  memberIds: string[],
): Promise<Record<string, FollowStatus>> {
  const out: Record<string, FollowStatus> = {};
  if (!followerId || memberIds.length === 0) return out;
  if (isDemoMode()) {
    for (const id of memberIds) {
      const status = demo.demoFollowState(followerId, id);
      if (status) out[id] = status;
    }
    return out;
  }
  const rows = await readInChunks(memberIds, async (chunk) => {
    const { data, error } = await supabase
      .from("follows")
      .select("followee_id, status")
      .eq("follower_id", followerId)
      .in("followee_id", chunk);
    if (error) throw error;
    return (data ?? []) as { followee_id: string; status: FollowStatus }[];
  });
  for (const r of rows) out[r.followee_id] = r.status;
  return out;
}

/**
 * The members who follow this one, up to PostgREST's thousand, with only
 * what a row draws. For ranking search results; a list on screen pages
 * with fetchFollowPage.
 */
export async function fetchFollowers(userId: string): Promise<MemberRow[]> {
  if (isDemoMode()) return demo.demoFetchFollowers(userId);

  const { data, error } = await supabase
    .from("follows")
    .select(`follower:profiles!follows_follower_id_fkey(${MEMBER_ROW})`)
    .eq("followee_id", userId)
    .eq("status", "accepted")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { follower: MemberRow | null }[])
    .map((r) => r.follower)
    .filter((p): p is MemberRow => p != null);
}

/** Among some members, whom the member follows and who follows them (accepted, both ways). */
export interface FollowsAmong {
  following: string[];
  followers: string[];
}

/**
 * Where the member stands with these members, and they with the member:
 * what ranks a search's results (src/utils/searchRank.ts). Read for the
 * results alone, never the member's whole lists: those were read in full
 * for it, and PostgREST stops at a thousand rows without saying so, so a
 * member following more than a thousand had some of them ranked as
 * strangers. Two small reads a hundred members at a time (./batch), each
 * through its own index (who the member follows; who follows them).
 */
export async function fetchFollowsAmong(userId: string, memberIds: string[]): Promise<FollowsAmong> {
  const out: FollowsAmong = { following: [], followers: [] };
  if (!userId || memberIds.length === 0) return out;
  if (isDemoMode()) {
    for (const id of memberIds) {
      if (demo.demoFollowState(userId, id) === "accepted") out.following.push(id);
      if (demo.demoFollowState(id, userId) === "accepted") out.followers.push(id);
    }
    return out;
  }
  const [following, followers] = await Promise.all([
    readInChunks(memberIds, async (chunk) => {
      const { data, error } = await supabase
        .from("follows")
        .select("followee_id")
        .eq("follower_id", userId)
        .eq("status", "accepted")
        .in("followee_id", chunk);
      if (error) throw error;
      return (data ?? []).map((r) => r.followee_id as string);
    }),
    readInChunks(memberIds, async (chunk) => {
      const { data, error } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("followee_id", userId)
        .eq("status", "accepted")
        .in("follower_id", chunk);
      if (error) throw error;
      return (data ?? []).map((r) => r.follower_id as string);
    }),
  ]);
  out.following = following;
  out.followers = followers;
  return out;
}

/**
 * The members this one follows, up to PostgREST's thousand, with only
 * what a row draws. Search ranks by fetchFollowsAmong instead; a list on
 * screen pages with fetchFollowPage.
 */
export async function fetchFollowing(userId: string): Promise<MemberRow[]> {
  if (isDemoMode()) return demo.demoFetchFollowing(userId);

  const { data, error } = await supabase
    .from("follows")
    .select(`followee:profiles!follows_followee_id_fkey(${MEMBER_ROW})`)
    .eq("follower_id", userId)
    .eq("status", "accepted")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { followee: MemberRow | null }[])
    .map((r) => r.followee)
    .filter((p): p is MemberRow => p != null);
}

/**
 * Whether the viewer may see this member's photographs. Public members are
 * open to every approved member; a private member is visible to themselves
 * and to accepted followers only.
 */
export async function canViewPosts(viewerId: string, authorId: string): Promise<boolean> {
  if (viewerId === authorId) return true;
  if (isDemoMode()) return demo.demoCanViewPosts(viewerId, authorId);

  const { data } = await supabase
    .from("profiles")
    .select("is_private")
    .eq("id", authorId)
    .maybeSingle();
  if (!data?.is_private) return true;
  return isFollowing(viewerId, authorId);
}

export async function unfollow(followerId: string, followeeId: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoUnfollow(followerId, followeeId);
    return;
  }
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId);
  if (error) throw error;
  forgetFollowingIds(followerId);
}
