import type {
  ActivityRow,
  ActivityWithRefs,
  ApplicationRow,
  ApplicationStatus,
  CommentRow,
  CommentWithAuthor,
  ConversationRow,
  ConversationWithPeer,
  FollowRow,
  FollowStatus,
  MessageRow,
  MessageWithPost,
  InviteRow,
  LikeRow,
  ModerationActionRow,
  PostRow,
  PostWithAuthor,
  ProfileRow,
  ReportRow,
  ReportStatus,
} from "@/types/db";
import { FOUNDING_MEMBER_LIMIT } from "@/utils/membership";
import {
  DEMO_APPLICATIONS,
  DEMO_COMMENTS,
  DEMO_CONVERSATIONS,
  DEMO_FOLLOWS,
  DEMO_MESSAGES,
  DEMO_IDS,
  DEMO_INVITES,
  DEMO_LIKES,
  DEMO_POSTS,
  DEMO_PROFILES,
  DEMO_REPORTS,
} from "./fixtures";

/**
 * The in-memory backend for demo mode (browser review without Supabase).
 * It mirrors the shapes and behavior of the real api layer closely enough
 * that every screen works: browsing, liking, commenting, following,
 * posting, the membership flow, and the admin dashboard. State lives for
 * the lifetime of the page — a refresh resets the demo.
 */

interface DemoState {
  profiles: ProfileRow[];
  posts: PostRow[];
  follows: FollowRow[];
  likes: LikeRow[];
  comments: CommentRow[];
  activity: ActivityRow[];
  applications: ApplicationRow[];
  invites: InviteRow[];
  reports: ReportRow[];
  moderationActions: ModerationActionRow[];
  conversations: ConversationRow[];
  messages: MessageRow[];
  currentUserId: string | null;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;

function initialState(): DemoState {
  const state: DemoState = {
    profiles: clone(DEMO_PROFILES),
    posts: clone(DEMO_POSTS),
    follows: clone(DEMO_FOLLOWS),
    likes: clone(DEMO_LIKES),
    comments: clone(DEMO_COMMENTS),
    activity: [],
    applications: clone(DEMO_APPLICATIONS),
    invites: clone(DEMO_INVITES),
    reports: clone(DEMO_REPORTS),
    moderationActions: [],
    conversations: clone(DEMO_CONVERSATIONS),
    messages: clone(DEMO_MESSAGES),
    currentUserId: null,
  };
  // Derive activity from the seeded likes/comments/follows so every
  // member's Activity tab feels lived-in.
  for (const l of state.likes) {
    const post = state.posts.find((p) => p.id === l.post_id);
    if (post && post.author_id !== l.user_id) {
      state.activity.push({
        id: newId("demo-activity"),
        recipient_id: post.author_id,
        actor_id: l.user_id,
        type: "like",
        post_id: l.post_id,
        comment_id: null,
        message: null,
        created_at: l.created_at,
        read_at: null,
      });
    }
  }
  for (const c of state.comments) {
    const post = state.posts.find((p) => p.id === c.post_id);
    if (post && post.author_id !== c.author_id) {
      state.activity.push({
        id: newId("demo-activity"),
        recipient_id: post.author_id,
        actor_id: c.author_id,
        type: "comment",
        post_id: c.post_id,
        comment_id: c.id,
        message: null,
        created_at: c.created_at,
        read_at: null,
      });
    }
  }
  for (const f of state.follows) {
    state.activity.push({
      id: newId("demo-activity"),
      recipient_id: f.followee_id,
      actor_id: f.follower_id,
      type: "follow",
      post_id: null,
      comment_id: null,
      message: null,
      created_at: f.created_at,
      read_at: null,
    });
  }
  recomputeCounts(state);
  return state;
}

function recomputeCounts(state: DemoState) {
  for (const profile of state.profiles) {
    profile.post_count = state.posts.filter(
      (p) => p.author_id === profile.id && !p.removed_at,
    ).length;
    profile.follower_count = state.follows.filter(
      (f) => f.followee_id === profile.id && f.status === "accepted",
    ).length;
    profile.following_count = state.follows.filter(
      (f) => f.follower_id === profile.id && f.status === "accepted",
    ).length;
  }
  for (const post of state.posts) {
    post.like_count = state.likes.filter((l) => l.post_id === post.id).length;
    post.comment_count = state.comments.filter(
      (c) => c.post_id === post.id && !c.removed_at,
    ).length;
  }
}

// The demo session survives page reloads (deep links, refresh) via
// sessionStorage in the browser; everything else resets by design.
const SESSION_KEY = "vintage-demo-user";

function readPersistedUser(): string | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
  } catch {
    return null;
  }
}

function persistUser(id: string | null) {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode etc.) — the session just won't survive reloads
  }
}

let state = initialState();
{
  const persisted = readPersistedUser();
  if (persisted && state.profiles.some((p) => p.id === persisted)) {
    state.currentUserId = persisted;
  }
}

// ---------------------------------------------------------------------------
// demo auth: a tiny pub/sub the SessionProvider subscribes to
// ---------------------------------------------------------------------------
type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function demoSubscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function demoCurrentProfile(): ProfileRow | null {
  if (!state.currentUserId) return null;
  const p = state.profiles.find((x) => x.id === state.currentUserId);
  return p ? clone(p) : null;
}

/**
 * Demo sign-in accepts any credentials: an email containing "admin" gets
 * the admin account, anything else gets Elena's member account.
 */
export function demoSignIn(email: string): void {
  state.currentUserId = email.toLowerCase().includes("admin") ? DEMO_IDS.admin : DEMO_IDS.elena;
  persistUser(state.currentUserId);
  emit();
}

export function demoSignOut(): void {
  state.currentUserId = null;
  persistUser(null);
  emit();
}

function requireUser(): string {
  if (!state.currentUserId) throw new Error("Demo: not signed in");
  return state.currentUserId;
}

const authorRef = (id: string) => {
  const p = state.profiles.find((x) => x.id === id);
  return {
    id,
    username: p?.username ?? "unknown",
    full_name: p?.full_name ?? null,
    avatar_url: p?.avatar_url ?? null,
  };
};

const withAuthor = (post: PostRow): PostWithAuthor => ({ ...clone(post), author: authorRef(post.author_id) });

// ---------------------------------------------------------------------------
// posts / feed
// ---------------------------------------------------------------------------
export function demoFetchFeedPage(userId: string, page: number, pageSize: number): PostWithAuthor[] {
  const followees = new Set(
    state.follows
      .filter((f) => f.follower_id === userId && f.status === "accepted")
      .map((f) => f.followee_id),
  );
  followees.add(userId);
  const feed = state.posts
    .filter((p) => followees.has(p.author_id) && !p.removed_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return feed.slice(page * pageSize, (page + 1) * pageSize).map(withAuthor);
}

export function demoFetchUserPosts(authorId: string): PostRow[] {
  return state.posts
    .filter((p) => p.author_id === authorId && !p.removed_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(clone);
}

export function demoFetchPost(postId: string): PostWithAuthor | null {
  const post = state.posts.find((p) => p.id === postId && !p.removed_at);
  return post ? withAuthor(post) : null;
}

export function demoCreatePost(post: Omit<PostRow, "like_count" | "comment_count" | "created_at" | "removed_at" | "removed_by">): void {
  state.posts.push({
    ...post,
    like_count: 0,
    comment_count: 0,
    created_at: new Date().toISOString(),
    removed_at: null,
    removed_by: null,
  });
  recomputeCounts(state);
}

export function demoDeletePost(postId: string): void {
  state.posts = state.posts.filter((p) => p.id !== postId);
  state.likes = state.likes.filter((l) => l.post_id !== postId);
  state.comments = state.comments.filter((c) => c.post_id !== postId);
  recomputeCounts(state);
}

export function demoFetchMyLikes(userId: string, postIds: string[]): Set<string> {
  const ids = new Set(postIds);
  return new Set(
    state.likes.filter((l) => l.user_id === userId && ids.has(l.post_id)).map((l) => l.post_id),
  );
}

export function demoLike(userId: string, postId: string): void {
  if (state.likes.some((l) => l.user_id === userId && l.post_id === postId)) return;
  state.likes.push({ post_id: postId, user_id: userId, created_at: new Date().toISOString() });
  recomputeCounts(state);
}

export function demoUnlike(userId: string, postId: string): void {
  state.likes = state.likes.filter((l) => !(l.user_id === userId && l.post_id === postId));
  recomputeCounts(state);
}

export function demoFetchComments(postId: string): CommentWithAuthor[] {
  return state.comments
    .filter((c) => c.post_id === postId && !c.removed_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((c) => ({ ...clone(c), author: authorRef(c.author_id) }));
}

export function demoCommentPreviews(
  postIds: string[],
  perPost: number,
): Record<string, CommentWithAuthor[]> {
  const wanted = new Set(postIds);
  const out: Record<string, CommentWithAuthor[]> = {};
  for (const c of state.comments) {
    if (!wanted.has(c.post_id) || c.removed_at) continue;
    (out[c.post_id] ??= []).push({ ...clone(c), author: authorRef(c.author_id) });
  }
  for (const id of Object.keys(out)) {
    out[id].sort((a, b) => a.created_at.localeCompare(b.created_at));
    out[id] = out[id].slice(-perPost);
  }
  return out;
}

export function demoAddComment(userId: string, postId: string, body: string): void {
  state.comments.push({
    id: newId("demo-comment"),
    post_id: postId,
    author_id: userId,
    body,
    created_at: new Date().toISOString(),
    removed_at: null,
    removed_by: null,
  });
  recomputeCounts(state);
}

export function demoDeleteComment(commentId: string): void {
  state.comments = state.comments.filter((c) => c.id !== commentId);
  recomputeCounts(state);
}

// ---------------------------------------------------------------------------
// profiles / follows / search
// ---------------------------------------------------------------------------
export function demoFetchProfileByUsername(username: string): ProfileRow | null {
  const p = state.profiles.find((x) => x.username === username.toLowerCase());
  return p ? clone(p) : null;
}

export function demoFetchProfileById(id: string): ProfileRow | null {
  const p = state.profiles.find((x) => x.id === id);
  return p ? clone(p) : null;
}

export function demoSearchProfiles(q: string): ProfileRow[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  return state.profiles
    .filter(
      (p) =>
        p.status === "approved" &&
        (p.username.includes(needle) || (p.full_name ?? "").toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(clone);
}

export function demoUpdateProfile(userId: string, edits: Partial<ProfileRow>): void {
  const p = state.profiles.find((x) => x.id === userId);
  if (p) Object.assign(p, edits);
  emit();
}

export function demoFollowState(followerId: string, followeeId: string): FollowStatus | null {
  const f = state.follows.find(
    (x) => x.follower_id === followerId && x.followee_id === followeeId,
  );
  return f?.status ?? null;
}

export function demoIsFollowing(followerId: string, followeeId: string): boolean {
  return demoFollowState(followerId, followeeId) === "accepted";
}

/** Returns the resulting state: 'pending' for a private member, else 'accepted'. */
export function demoFollow(followerId: string, followeeId: string): FollowStatus {
  const existing = demoFollowState(followerId, followeeId);
  if (existing) return existing;
  if (followerId === followeeId) return "accepted";
  const followee = state.profiles.find((p) => p.id === followeeId);
  const status: FollowStatus = followee?.is_private ? "pending" : "accepted";
  state.follows.push({
    follower_id: followerId,
    followee_id: followeeId,
    status,
    created_at: new Date().toISOString(),
  });
  state.activity.push({
    id: newId("demo-activity"),
    recipient_id: followeeId,
    actor_id: followerId,
    type: status === "pending" ? "follow_request" : "follow",
    post_id: null,
    comment_id: null,
    message: null,
    created_at: new Date().toISOString(),
    read_at: null,
  });
  recomputeCounts(state);
  emit();
  return status;
}

/** A private member accepting or declining a waiting request. */
export function demoDecideFollowRequest(
  followerId: string,
  followeeId: string,
  accept: boolean,
): void {
  const f = state.follows.find(
    (x) => x.follower_id === followerId && x.followee_id === followeeId,
  );
  if (!f || f.status !== "pending") return;
  if (accept) {
    f.status = "accepted";
  } else {
    state.follows = state.follows.filter((x) => x !== f);
  }
  state.activity = state.activity.filter(
    (a) =>
      !(a.type === "follow_request" && a.actor_id === followerId && a.recipient_id === followeeId),
  );
  recomputeCounts(state);
  emit();
}

export function demoFetchFollowing(userId: string): ProfileRow[] {
  return state.follows
    .filter((f) => f.follower_id === userId && f.status === "accepted")
    .map((f) => state.profiles.find((p) => p.id === f.followee_id))
    .filter((p): p is ProfileRow => Boolean(p))
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(clone);
}

export function demoPendingRequests(followeeId: string): ProfileRow[] {
  return state.follows
    .filter((f) => f.followee_id === followeeId && f.status === "pending")
    .map((f) => state.profiles.find((p) => p.id === f.follower_id))
    .filter((p): p is ProfileRow => Boolean(p))
    .map(clone);
}

/**
 * Whether `viewerId` may see `authorId`'s photographs. Public members are
 * open to every approved member; a private member is visible to themselves
 * and to accepted followers only.
 */
export function demoCanViewPosts(viewerId: string, authorId: string): boolean {
  if (viewerId === authorId) return true;
  const author = state.profiles.find((p) => p.id === authorId);
  if (!author?.is_private) return true;
  return demoIsFollowing(viewerId, authorId);
}

export function demoUnfollow(followerId: string, followeeId: string): void {
  state.follows = state.follows.filter(
    (f) => !(f.follower_id === followerId && f.followee_id === followeeId),
  );
  recomputeCounts(state);
  emit();
}

// ---------------------------------------------------------------------------
// activity
// ---------------------------------------------------------------------------
export function demoFetchActivity(userId: string): ActivityWithRefs[] {
  return state.activity
    .filter((a) => a.recipient_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 60)
    .map((a) => {
      const post = a.post_id ? state.posts.find((p) => p.id === a.post_id) : null;
      return {
        ...clone(a),
        actor: a.actor_id ? authorRef(a.actor_id) : null,
        post: post
          ? {
              id: post.id,
              media_path: post.media_path,
              thumb_path: post.thumb_path,
              media_type: post.media_type,
            }
          : null,
      };
    });
}

export function demoMarkActivityRead(userId: string): void {
  const now = new Date().toISOString();
  for (const a of state.activity) {
    if (a.recipient_id === userId && !a.read_at) a.read_at = now;
  }
}

// ---------------------------------------------------------------------------
// membership: applications & invites
// ---------------------------------------------------------------------------
/**
 * The demo mirror of `assign_member_no`: the next number in sequence, once,
 * permanently. A member who already has one keeps it — that is what makes
 * the number survive suspension and reinstatement.
 */
function assignMemberNo(userId: string): number {
  const profile = state.profiles.find((p) => p.id === userId);
  if (!profile) return 0;
  if (profile.member_no !== null) return profile.member_no;
  const highest = state.profiles.reduce((n, p) => Math.max(n, p.member_no ?? 0), 0);
  profile.member_no = highest + 1;
  return profile.member_no;
}

/** A moderation note in someone's activity, as the definer functions write. */
function note(recipientId: string, message: string, actorId: string | null = null): void {
  state.activity.push({
    id: newId("demo-activity"),
    recipient_id: recipientId,
    actor_id: actorId,
    type: "moderation",
    post_id: null,
    comment_id: null,
    message,
    created_at: new Date().toISOString(),
    read_at: null,
  });
}

/** The welcome note the database writes when someone is let in. */
function welcomeMessage(memberNo: number): string {
  const printed = `no. ${String(memberNo).padStart(5, "0")}`;
  return memberNo <= FOUNDING_MEMBER_LIMIT
    ? `Welcome to VINTAGE. You are founding member ${printed}.`
    : `Welcome to VINTAGE. You are member ${printed}.`;
}

export function demoUsernameAvailable(username: string): boolean {
  return !state.profiles.some((p) => p.username === username.toLowerCase());
}

export function demoSubmitApplication(input: {
  fullName: string;
  desiredUsername: string;
  avatarUri: string | null;
  socialHandle: string;
  city: string;
  inviter: string;
  reason: string;
}): void {
  const id = newId("demo-applicant");
  state.profiles.push({
    id,
    username: input.desiredUsername.toLowerCase(),
    full_name: input.fullName,
    bio: "",
    avatar_url: input.avatarUri,
    city: input.city || null,
    social_handle: input.socialHandle || null,
    role: "member",
    status: "applied",
    invite_quota: 0,
    member_no: null, // no number until an admin lets them in
    invited_by: null,
    is_private: false,
    post_count: 0,
    follower_count: 0,
    following_count: 0,
    created_at: new Date().toISOString(),
    approved_at: null,
  });
  state.applications.push({
    id: newId("demo-app"),
    user_id: id,
    full_name: input.fullName,
    desired_username: input.desiredUsername.toLowerCase(),
    avatar_url: input.avatarUri,
    social_handle: input.socialHandle || null,
    city: input.city || null,
    inviter: input.inviter || null,
    reason: input.reason,
    status: "pending",
    decided_by: null,
    decided_at: null,
    created_at: new Date().toISOString(),
  });
  state.currentUserId = id;
  persistUser(id);
  emit();
}

/**
 * Redeem an invitation: the code is consumed, the member is let straight in,
 * the number is issued, and who vouched for them is recorded permanently.
 * Mirrors `redeem_invite`.
 */
/**
 * Invitation links, in demo mode.
 *
 * One per member, held in the same in-memory store as everything else, so
 * the browser build behaves like the real thing: a slug you can change, an
 * allowance that is only spent when somebody joins, and a rotate that
 * retires the old address.
 */
const inviteLinks = new Map<string, string>();

function defaultSlug(username: string): string {
  const derived = username.replace(/\./g, "-");
  return derived.length >= 8 ? derived : `${derived}-invitation`;
}

function slugFor(userId: string): string {
  const existing = inviteLinks.get(userId);
  if (existing) return existing;
  const me = state.profiles.find((p) => p.id === userId);
  const slug = defaultSlug(me?.username ?? "member");
  inviteLinks.set(userId, slug);
  return slug;
}

/**
 * Whose link is this? Explicit ones first, then the default a member would
 * be given on first use — so every seeded member's link resolves without
 * the store having to walk the whole cast at startup, which is how the
 * database behaves too.
 */
function ownerOfSlug(slug: string): string | null {
  const wanted = slug.trim().toLowerCase();
  for (const [owner, taken] of inviteLinks) {
    if (taken === wanted) return owner;
  }
  const derived = state.profiles.find(
    (p) => !inviteLinks.has(p.id) && defaultSlug(p.username) === wanted,
  );
  return derived?.id ?? null;
}

function usedBy(userId: string): number {
  return state.profiles.filter((p) => p.invited_by === userId).length;
}

export function demoInviteLink(): { slug: string; allowance: number; used: number } {
  const userId = requireUser();
  const me = state.profiles.find((p) => p.id === userId);
  return {
    slug: slugFor(userId),
    allowance: me?.invite_quota ?? 0,
    used: usedBy(userId),
  };
}

export function demoSetInviteSlug(slug: string): string {
  const userId = requireUser();
  const next = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(next)) {
    throw new Error(
      "A suffix is 8 to 64 letters, numbers or hyphens, and cannot begin or end with a hyphen.",
    );
  }
  const owner = ownerOfSlug(next);
  if (owner && owner !== userId) throw new Error("That suffix is already in use.");
  inviteLinks.set(userId, next);
  return next;
}

export function demoRotateInviteLink(): string {
  const userId = requireUser();
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let slug = "";
  for (let i = 0; i < 12; i++) slug += alphabet[Math.floor(Math.random() * alphabet.length)];
  inviteLinks.set(userId, slug);
  return slug;
}

export function demoInviteOwner(slug: string): { inviter: string | null; open: boolean } {
  const owner = ownerOfSlug(slug);
  const me = owner ? state.profiles.find((p) => p.id === owner) : undefined;
  if (!owner || !me || me.status !== "approved") return { inviter: null, open: false };
  return {
    inviter: me.full_name || me.username,
    open: usedBy(owner) < me.invite_quota,
  };
}

export function demoJoinWithInvite(input: {
  fullName: string;
  desiredUsername: string;
  code: string;
}): void {
  // `code` is now the link's suffix. Find whose it is, and check they still
  // have room — the allowance is spent on joining, not on sending.
  const inviter = ownerOfSlug(input.code);
  const host = inviter ? state.profiles.find((p) => p.id === inviter) : undefined;
  if (!inviter || !host || host.status !== "approved" || usedBy(inviter) >= host.invite_quota) {
    throw new Error(
      "That invitation is no longer open. The member who sent it may have used all of theirs, " +
        "or replaced the link.",
    );
  }
  const id = newId("demo-member");
  state.profiles.push({
    id,
    username: input.desiredUsername.toLowerCase(),
    full_name: input.fullName,
    bio: "",
    avatar_url: null,
    city: null,
    social_handle: null,
    role: "member",
    status: "approved",
    invite_quota: 3,
    member_no: null, // issued just below, the way redeem_invite does
    invited_by: inviter,
    is_private: false,
    post_count: 0,
    follower_count: 0,
    following_count: 0,
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
  });
  const memberNo = assignMemberNo(id);
  note(id, welcomeMessage(memberNo));
  // The member whose link it was sees that somebody came through it.
  note(inviter, "Someone joined VINTAGE on your invitation.", id);

  // New members start by following a few of the regulars so Home is alive.
  // Routed through demoFollow rather than written straight into the table,
  // so a private member's account still waits on their approval instead of
  // being handed an accepted follower.
  state.currentUserId = id;
  for (const followee of [DEMO_IDS.june, DEMO_IDS.sam, DEMO_IDS.tomas, DEMO_IDS.arthur]) {
    demoFollow(id, followee);
  }
  recomputeCounts(state);
  persistUser(id);
  emit();
}

export function demoFetchMyApplication(userId: string): ApplicationRow | null {
  const app = state.applications
    .filter((a) => a.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return app ? clone(app) : null;
}


// ---------------------------------------------------------------------------
// moderation
// ---------------------------------------------------------------------------
export function demoSubmitReport(report: Omit<ReportRow, "id" | "status" | "resolution_note" | "resolved_by" | "resolved_at" | "created_at">): void {
  state.reports.push({
    ...report,
    id: newId("demo-report"),
    status: "open",
    resolution_note: null,
    resolved_by: null,
    resolved_at: null,
    created_at: new Date().toISOString(),
  });
}

export function demoFetchApplications(status: ApplicationStatus): ApplicationRow[] {
  return state.applications
    .filter((a) => a.status === status)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(clone);
}

export function demoDecideApplication(applicationId: string, decision: Exclude<ApplicationStatus, "pending">): void {
  const app = state.applications.find((a) => a.id === applicationId);
  if (!app) return;
  app.status = decision;
  app.decided_by = state.currentUserId;
  app.decided_at = new Date().toISOString();
  const profile = state.profiles.find((p) => p.id === app.user_id);
  if (profile) {
    profile.status = decision === "approved" ? "approved" : decision;
    if (decision === "approved") {
      profile.approved_at = new Date().toISOString();
      profile.invite_quota = Math.max(profile.invite_quota, 3);
      // Approval is the moment the number is issued, and it is permanent.
      note(profile.id, welcomeMessage(assignMemberNo(profile.id)));
    }
  }
  recomputeCounts(state);
  emit();
}

export function demoFetchReports(status: ReportStatus) {
  return state.reports
    .filter((r) => r.status === status)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({ ...clone(r), reporter: authorRef(r.reporter_id) }));
}

export function demoResolveReport(reportId: string, status: Exclude<ReportStatus, "open">, resolution: string): void {
  const r = state.reports.find((x) => x.id === reportId);
  if (!r) return;
  r.status = status;
  r.resolution_note = resolution;
  r.resolved_by = state.currentUserId;
  r.resolved_at = new Date().toISOString();
  emit();
}

function recordModeration(action: ModerationActionRow["action"], targetProfileId: string, note: string, refs: { post_id?: string; comment_id?: string } = {}) {
  state.moderationActions.push({
    id: newId("demo-modaction"),
    admin_id: state.currentUserId ?? DEMO_IDS.admin,
    target_profile_id: targetProfileId,
    action,
    post_id: refs.post_id ?? null,
    comment_id: refs.comment_id ?? null,
    note,
    created_at: new Date().toISOString(),
  });
}

export function demoWarnMember(profileId: string, note: string): void {
  recordModeration("warning", profileId, note);
  state.activity.push({
    id: newId("demo-activity"),
    recipient_id: profileId,
    actor_id: null,
    type: "moderation",
    post_id: null,
    comment_id: null,
    message: `A note from the admins: ${note}`,
    created_at: new Date().toISOString(),
    read_at: null,
  });
}

export function demoSetSuspension(profileId: string, suspended: boolean, note: string): void {
  const p = state.profiles.find((x) => x.id === profileId);
  if (p) p.status = suspended ? "suspended" : "approved";
  recordModeration(suspended ? "suspension" : "reinstatement", profileId, note);
  emit();
}

export function demoRemovePost(postId: string, note: string): void {
  const post = state.posts.find((p) => p.id === postId);
  if (!post || post.removed_at) return;
  post.removed_at = new Date().toISOString();
  post.removed_by = state.currentUserId;
  recordModeration("post_removal", post.author_id, note, { post_id: postId });
  recomputeCounts(state);
}

export function demoRemoveComment(commentId: string, note: string): void {
  const c = state.comments.find((x) => x.id === commentId);
  if (!c || c.removed_at) return;
  c.removed_at = new Date().toISOString();
  c.removed_by = state.currentUserId;
  recordModeration("comment_removal", c.author_id, note, { comment_id: commentId });
  recomputeCounts(state);
}

export function demoFetchModerationLog(): ModerationActionRow[] {
  return state.moderationActions
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 100)
    .map(clone);
}

export function demoFetchMembers(q: string): ProfileRow[] {
  const needle = q.trim().toLowerCase();
  return state.profiles
    .filter(
      (p) =>
        !needle || p.username.includes(needle) || (p.full_name ?? "").toLowerCase().includes(needle),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50)
    .map(clone);
}

/** Test hook: reset the demo world to its initial fixtures. */
export function demoReset(): void {
  state = initialState();
  emit();
}

// ---------------------------------------------------------------------------
// explore
// ---------------------------------------------------------------------------
/**
 * Photographs from across VINTAGE, newest first — the one place you see work
 * by members you don't follow. Private members are excluded unless the viewer
 * already follows them, and your own posts are left out: explore is for
 * finding other people.
 */
export function demoFetchExplore(viewerId: string, limit: number): PostRow[] {
  return state.posts
    .filter(
      (p) =>
        !p.removed_at &&
        p.author_id !== viewerId &&
        demoCanViewPosts(viewerId, p.author_id),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map(clone);
}

// ---------------------------------------------------------------------------
// direct messages
// ---------------------------------------------------------------------------
/** The pair, in the fixed order the conversations table stores them. */
function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function demoFetchConversations(userId: string): ConversationWithPeer[] {
  return state.conversations
    .filter((c) => c.user_a === userId || c.user_b === userId)
    .map((c) => {
      const peerId = c.user_a === userId ? c.user_b : c.user_a;
      const peer = state.profiles.find((p) => p.id === peerId);
      const messages = state.messages
        .filter((m) => m.conversation_id === c.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return {
        ...clone(c),
        peer: peer
          ? {
              id: peer.id,
              username: peer.username,
              full_name: peer.full_name,
              avatar_url: peer.avatar_url,
            }
          : { id: peerId, username: "someone", full_name: null, avatar_url: null },
        last_message: messages.length ? clone(messages[messages.length - 1]) : null,
        unread_count: messages.filter((m) => m.sender_id !== userId && !m.read_at).length,
      };
    })
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
}

export function demoUnreadMessageCount(userId: string): number {
  return demoFetchConversations(userId).reduce((n, c) => n + c.unread_count, 0);
}

/** Find the thread with this member, opening one if they've never spoken. */
export function demoOpenConversation(userId: string, peerId: string): string {
  const [a, b] = pairKey(userId, peerId);
  const existing = state.conversations.find((c) => c.user_a === a && c.user_b === b);
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const conversation: ConversationRow = {
    id: newId("demo-convo"),
    user_a: a,
    user_b: b,
    created_at: now,
    last_message_at: now,
  };
  state.conversations.push(conversation);
  emit();
  return conversation.id;
}

export function demoFetchMessages(conversationId: string): MessageWithPost[] {
  return state.messages
    .filter((m) => m.conversation_id === conversationId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({
      ...clone(m),
      post: m.post_id ? demoFetchPost(m.post_id) : null,
    }));
}

export function demoSendMessage(
  conversationId: string,
  senderId: string,
  body: string,
  postId: string | null,
): void {
  if (!body.trim() && !postId) return;
  const now = new Date().toISOString();
  state.messages.push({
    id: newId("demo-message"),
    conversation_id: conversationId,
    sender_id: senderId,
    body: body.trim(),
    post_id: postId,
    created_at: now,
    read_at: null,
  });
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (conversation) conversation.last_message_at = now;
  emit();
}

export function demoMarkConversationRead(conversationId: string, userId: string): void {
  const now = new Date().toISOString();
  let changed = false;
  for (const m of state.messages) {
    if (m.conversation_id === conversationId && m.sender_id !== userId && !m.read_at) {
      m.read_at = now;
      changed = true;
    }
  }
  if (changed) emit();
}

export function demoConversationPeer(conversationId: string, userId: string): ProfileRow | null {
  const c = state.conversations.find((x) => x.id === conversationId);
  if (!c) return null;
  const peerId = c.user_a === userId ? c.user_b : c.user_a;
  return clone(state.profiles.find((p) => p.id === peerId) ?? null);
}
