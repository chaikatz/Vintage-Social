import type {
  ActivityRow,
  ActivityWithRefs,
  ApplicationRow,
  ApplicationStatus,
  CommentRow,
  CommentWithAuthor,
  FollowRow,
  InviteRow,
  LikeRow,
  ModerationActionRow,
  PostRow,
  PostWithAuthor,
  ProfileRow,
  ReportRow,
  ReportStatus,
} from "@/types/db";
import {
  DEMO_APPLICATIONS,
  DEMO_COMMENTS,
  DEMO_FOLLOWS,
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
    profile.follower_count = state.follows.filter((f) => f.followee_id === profile.id).length;
    profile.following_count = state.follows.filter((f) => f.follower_id === profile.id).length;
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
    state.follows.filter((f) => f.follower_id === userId).map((f) => f.followee_id),
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

export function demoIsFollowing(followerId: string, followeeId: string): boolean {
  return state.follows.some((f) => f.follower_id === followerId && f.followee_id === followeeId);
}

export function demoFollow(followerId: string, followeeId: string): void {
  if (demoIsFollowing(followerId, followeeId) || followerId === followeeId) return;
  state.follows.push({
    follower_id: followerId,
    followee_id: followeeId,
    created_at: new Date().toISOString(),
  });
  recomputeCounts(state);
}

export function demoUnfollow(followerId: string, followeeId: string): void {
  state.follows = state.follows.filter(
    (f) => !(f.follower_id === followerId && f.followee_id === followeeId),
  );
  recomputeCounts(state);
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

/** Any well-formed code admits the demo visitor as a fresh approved member. */
export function demoJoinWithInvite(input: { fullName: string; desiredUsername: string }): void {
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
    post_count: 0,
    follower_count: 0,
    following_count: 0,
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
  });
  // New members start by following a few of the regulars so Home is alive.
  for (const followee of [DEMO_IDS.elena, DEMO_IDS.june, DEMO_IDS.sam]) {
    state.follows.push({ follower_id: id, followee_id: followee, created_at: new Date().toISOString() });
  }
  recomputeCounts(state);
  state.currentUserId = id;
  persistUser(id);
  emit();
}

export function demoFetchMyApplication(userId: string): ApplicationRow | null {
  const app = state.applications
    .filter((a) => a.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return app ? clone(app) : null;
}

export function demoFetchMyInvites(userId: string): InviteRow[] {
  return state.invites
    .filter((i) => i.created_by === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(clone);
}

export function demoCreateInvite(): string {
  const userId = requireUser();
  const me = state.profiles.find((p) => p.id === userId);
  const minted = state.invites.filter((i) => i.created_by === userId).length;
  if (!me || minted >= me.invite_quota) {
    throw new Error("You have used all of your invitations");
  }
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () => alphabet[Math.floor(Math.random() * alphabet.length)];
  const code = `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`;
  state.invites.push({
    id: newId("demo-invite"),
    code,
    created_by: userId,
    used_by: null,
    created_at: new Date().toISOString(),
    used_at: null,
  });
  return code;
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
    }
  }
  emit();
}

export function demoFetchReports(status: ReportStatus) {
  return state.reports
    .filter((r) => r.status === status)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({ ...clone(r), reporter: authorRef(r.reporter_id) }));
}

export function demoResolveReport(reportId: string, status: Exclude<ReportStatus, "open">, note: string): void {
  const r = state.reports.find((x) => x.id === reportId);
  if (!r) return;
  r.status = status;
  r.resolution_note = note;
  r.resolved_by = state.currentUserId;
  r.resolved_at = new Date().toISOString();
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
