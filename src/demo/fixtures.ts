import type {
  ActivityRow,
  ApplicationRow,
  CommentRow,
  FollowRow,
  InviteRow,
  LikeRow,
  PostRow,
  ProfileRow,
  ReportRow,
} from "@/types/db";
import { demoAvatar, demoPhotoPath } from "./photos";

/**
 * Demo-mode fixtures: the same fictional membership as supabase/seed.sql,
 * expressed as plain objects for the in-memory store. Used only when the
 * app runs without a Supabase backend (browser review builds).
 */

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

const face = (seed: string) => demoAvatar(seed);
const photo = (seed: string) => demoPhotoPath(seed);
const thumb = (seed: string) => demoPhotoPath(seed);

export const DEMO_IDS = {
  admin: "demo-user-admin",
  elena: "demo-user-elena",
  tomas: "demo-user-tomas",
  june: "demo-user-june",
  arthur: "demo-user-arthur",
  clara: "demo-user-clara",
  otis: "demo-user-otis",
  margot: "demo-user-margot",
  sam: "demo-user-sam",
  ines: "demo-user-ines",
  niko: "demo-user-niko",
  ruby: "demo-user-ruby",
  dex: "demo-user-dex",
} as const;

function member(
  id: string,
  username: string,
  fullName: string,
  bio: string,
  city: string,
  socialHandle: string | null,
  avatarSeed: string,
  createdDaysAgo: number,
  overrides: Partial<ProfileRow> = {},
): ProfileRow {
  return {
    id,
    username,
    full_name: fullName,
    bio,
    avatar_url: face(avatarSeed),
    city,
    social_handle: socialHandle,
    role: "member",
    status: "approved",
    invite_quota: 3,
    post_count: 0, // recomputed by the store
    follower_count: 0,
    following_count: 0,
    created_at: daysAgo(createdDaysAgo),
    approved_at: daysAgo(createdDaysAgo - 1),
    ...overrides,
  };
}

export const DEMO_PROFILES: ProfileRow[] = [
  member(DEMO_IDS.admin, "vintage", "VINTAGE", "Keeper of the archive.", "New York", null, "vintage-admin", 400, {
    role: "admin",
    invite_quota: 99,
  }),
  member(DEMO_IDS.elena, "elena.marchetti", "Elena Marchetti", "Film first. 35mm, mostly Milan.", "Milan", "@elena.marchetti", "elena-face", 380),
  member(DEMO_IDS.tomas, "tomas.lindqvist", "Tomas Lindqvist", "North light. Quiet water.", "Stockholm", "@t.lindqvist", "tomas-face", 360),
  member(DEMO_IDS.june, "june.nakamura", "June Nakamura", "Gardens, trains, breakfast.", "Kyoto", "@june.naka", "june-face", 340),
  member(DEMO_IDS.arthur, "arthur.beaumont", "Arthur Beaumont", "Old cafés and older stone.", "Paris", "@a.beaumont", "arthur-face", 300),
  member(DEMO_IDS.clara, "clara.reyes", "Clara Reyes", "Color, but gently.", "Mexico City", "@clara.rys", "clara-face", 260),
  member(DEMO_IDS.otis, "otis.whitfield", "Otis Whitfield", "Brass bands and porch light.", "New Orleans", "@otis.w", "otis-face", 220),
  member(DEMO_IDS.margot, "margot.dubois", "Margot Dubois", "Markets before eight.", "Lyon", "@margot.db", "margot-face", 180),
  member(DEMO_IDS.sam, "sam.okafor", "Sam Okafor", "Streets, faces, weather.", "Lagos", "@sam.okf", "sam-face", 140),
  member(DEMO_IDS.ines, "ines.almeida", "Inês Almeida", "Tiles and tide.", "Lisbon", "@ines.alm", "ines-face", 100),
  member(DEMO_IDS.niko, "niko.papadakis", "Niko Papadakis", "Islands off-season.", "Athens", "@niko.pap", "niko-face", 60),
  member(DEMO_IDS.ruby, "ruby.calloway", "Ruby Calloway", "", "Portland", "@rubyshoots", "ruby-face", 3, {
    status: "applied",
    invite_quota: 0,
  }),
  member(DEMO_IDS.dex, "dex.morrow", "Dex Morrow", "", "Chicago", "@dexmorrow", "dex-face", 1, {
    status: "applied",
    invite_quota: 0,
    avatar_url: null,
  }),
];

function post(
  id: string,
  authorId: string,
  seed: string,
  w: number,
  h: number,
  filterId: string,
  caption: string,
  createdHoursAgo: number,
  overrides: Partial<PostRow> = {},
): PostRow {
  return {
    id,
    author_id: authorId,
    media_type: "photo",
    media_path: photo(seed),
    thumb_path: thumb(seed),
    width: w,
    height: h,
    duration_seconds: null,
    filter_id: filterId,
    show_date_stamp: false,
    caption,
    like_count: 0, // recomputed by the store
    comment_count: 0,
    created_at: hoursAgo(createdHoursAgo),
    removed_at: null,
    removed_by: null,
    ...overrides,
  };
}

export const DEMO_POSTS: PostRow[] = [
  post("demo-post-01", DEMO_IDS.elena, "milan-tram", 1200, 1500, "chrome-64", "The 19 tram, before anyone was awake.", 2),
  post("demo-post-02", DEMO_IDS.elena, "milan-cortile", 1200, 1200, "seventy", "Nonna’s courtyard. Nothing has moved since 1974.", 48),
  post("demo-post-03", DEMO_IDS.elena, "milan-nebbia", 1200, 1500, "archive-bw", "Fog on the Naviglio.", 144),
  post("demo-post-04", DEMO_IDS.elena, "milan-mercato", 1200, 960, "ninety-eight", "Saturday market, closing time.", 288, { show_date_stamp: true }),
  post("demo-post-05", DEMO_IDS.tomas, "sthlm-ferry", 1200, 1500, "alpine", "Last ferry of the evening.", 5),
  post("demo-post-06", DEMO_IDS.tomas, "sthlm-ice", 1200, 1200, "alpine", "The bay decided to be a mirror today.", 72),
  post("demo-post-07", DEMO_IDS.tomas, "sthlm-cabin", 1200, 1500, "neutral-aged", "Grandfather’s cabin, opened for the season.", 216),
  post("demo-post-08", DEMO_IDS.june, "kyoto-moss", 1200, 1500, "instant", "Moss garden after the rain.", 8),
  post("demo-post-09", DEMO_IDS.june, "kyoto-train", 1200, 960, "ninety-eight", "The slow line home.", 96, { show_date_stamp: true }),
  post("demo-post-10", DEMO_IDS.june, "kyoto-breakfast", 1200, 1200, "seventy", "Breakfast for one, table for four.", 264),
  post("demo-post-11", DEMO_IDS.june, "kyoto-video", 1280, 720, "neutral-aged", "Wind through the bamboo, fifteen seconds of it.", 168, {
    media_type: "video",
    media_path: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    thumb_path: thumb("kyoto-video"),
    duration_seconds: 15,
  }),
  post("demo-post-12", DEMO_IDS.arthur, "paris-cafe", 1200, 1500, "seventy", "The waiter has worked here forty years. It shows, kindly.", 26),
  post("demo-post-13", DEMO_IDS.arthur, "paris-stone", 1200, 1200, "archive-bw", "Rue des Barres, seven in the morning.", 120),
  post("demo-post-14", DEMO_IDS.arthur, "paris-seine", 1200, 960, "chrome-64", "The Seine doing its usual impression of a painting.", 336),
  post("demo-post-15", DEMO_IDS.clara, "cdmx-wall", 1200, 1500, "riviera", "A wall that has been three colors and remembers all of them.", 10, { show_date_stamp: true }),
  post("demo-post-16", DEMO_IDS.clara, "cdmx-market", 1200, 1200, "chrome-64", "Marigold season at the mercado.", 96),
  post("demo-post-17", DEMO_IDS.clara, "cdmx-plaza", 1200, 1500, "instant", "Sunday, the plaza, everyone’s grandfather.", 312),
  post("demo-post-18", DEMO_IDS.otis, "nola-porch", 1200, 1500, "seventy", "Porch light hour.", 18, { show_date_stamp: true }),
  post("demo-post-19", DEMO_IDS.otis, "nola-brass", 1200, 960, "ninety-eight", "Second line on Frenchmen. You could hear this photo.", 144),
  post("demo-post-20", DEMO_IDS.otis, "nola-video", 1280, 720, "ninety-eight", "Streetcar passing, thirty seconds of bell.", 240, {
    media_type: "video",
    media_path: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
    thumb_path: thumb("nola-video"),
    duration_seconds: 30,
  }),
  post("demo-post-21", DEMO_IDS.margot, "lyon-market", 1200, 1500, "neutral-aged", "The cheese man saves me the good one.", 30),
  post("demo-post-22", DEMO_IDS.margot, "lyon-traboule", 1200, 1200, "archive-bw", "Traboules before the tours arrive.", 192),
  post("demo-post-23", DEMO_IDS.sam, "lagos-street", 1200, 1500, "chrome-64", "Yaba, golden hour, everything moving except this man.", 3),
  post("demo-post-24", DEMO_IDS.sam, "lagos-rain", 1200, 1200, "ninety-eight", "First rain of the season.", 120, { show_date_stamp: true }),
  post("demo-post-25", DEMO_IDS.sam, "lagos-tailor", 1200, 1500, "seventy", "My tailor, mid-argument, winning.", 360),
  post("demo-post-26", DEMO_IDS.ines, "lisboa-tiles", 1200, 1500, "riviera", "Azulejos doing their quiet blue thing.", 22, { show_date_stamp: true }),
  post("demo-post-27", DEMO_IDS.ines, "lisboa-tram", 1200, 1200, "seventy", "The 28, empty for once.", 168),
  post("demo-post-28", DEMO_IDS.ines, "lisboa-praia", 1200, 960, "riviera", "Off-season Atlantic.", 384),
  post("demo-post-29", DEMO_IDS.niko, "athens-cats", 1200, 1500, "riviera", "The committee that runs this neighborhood.", 14),
  post("demo-post-30", DEMO_IDS.niko, "athens-ferry", 1200, 1200, "alpine", "Ferry to nowhere in particular.", 144),
  post("demo-post-31", DEMO_IDS.niko, "athens-october", 1200, 1500, "instant", "October light is the honest one.", 432, { show_date_stamp: true }),
];

const follow = (follower: string, followee: string, d: number): FollowRow => ({
  follower_id: follower,
  followee_id: followee,
  created_at: daysAgo(d),
});

const everyone = [
  DEMO_IDS.elena, DEMO_IDS.tomas, DEMO_IDS.june, DEMO_IDS.arthur, DEMO_IDS.clara,
  DEMO_IDS.otis, DEMO_IDS.margot, DEMO_IDS.sam, DEMO_IDS.ines, DEMO_IDS.niko,
];

export const DEMO_FOLLOWS: FollowRow[] = [
  // the admin follows everyone
  ...everyone.map((id, i) => follow(DEMO_IDS.admin, id, 50 + i)),
  follow(DEMO_IDS.elena, DEMO_IDS.tomas, 80),
  follow(DEMO_IDS.elena, DEMO_IDS.june, 74),
  follow(DEMO_IDS.elena, DEMO_IDS.arthur, 70),
  follow(DEMO_IDS.elena, DEMO_IDS.margot, 44),
  follow(DEMO_IDS.elena, DEMO_IDS.niko, 30),
  follow(DEMO_IDS.tomas, DEMO_IDS.elena, 78),
  follow(DEMO_IDS.tomas, DEMO_IDS.june, 60),
  follow(DEMO_IDS.tomas, DEMO_IDS.sam, 40),
  follow(DEMO_IDS.june, DEMO_IDS.elena, 76),
  follow(DEMO_IDS.june, DEMO_IDS.tomas, 66),
  follow(DEMO_IDS.june, DEMO_IDS.clara, 52),
  follow(DEMO_IDS.june, DEMO_IDS.ines, 28),
  follow(DEMO_IDS.arthur, DEMO_IDS.elena, 68),
  follow(DEMO_IDS.arthur, DEMO_IDS.margot, 46),
  follow(DEMO_IDS.clara, DEMO_IDS.elena, 58),
  follow(DEMO_IDS.clara, DEMO_IDS.otis, 50),
  follow(DEMO_IDS.clara, DEMO_IDS.sam, 36),
  follow(DEMO_IDS.otis, DEMO_IDS.clara, 48),
  follow(DEMO_IDS.otis, DEMO_IDS.sam, 34),
  follow(DEMO_IDS.margot, DEMO_IDS.elena, 42),
  follow(DEMO_IDS.margot, DEMO_IDS.arthur, 40),
  follow(DEMO_IDS.margot, DEMO_IDS.ines, 24),
  follow(DEMO_IDS.sam, DEMO_IDS.tomas, 38),
  follow(DEMO_IDS.sam, DEMO_IDS.clara, 32),
  follow(DEMO_IDS.sam, DEMO_IDS.otis, 30),
  follow(DEMO_IDS.ines, DEMO_IDS.elena, 26),
  follow(DEMO_IDS.ines, DEMO_IDS.june, 22),
  follow(DEMO_IDS.ines, DEMO_IDS.margot, 20),
  follow(DEMO_IDS.niko, DEMO_IDS.elena, 18),
  follow(DEMO_IDS.niko, DEMO_IDS.ines, 16),
  follow(DEMO_IDS.niko, DEMO_IDS.arthur, 14),
];

const like = (postId: string, userId: string, h: number): LikeRow => ({
  post_id: postId,
  user_id: userId,
  created_at: hoursAgo(h),
});

export const DEMO_LIKES: LikeRow[] = [
  like("demo-post-01", DEMO_IDS.tomas, 1), like("demo-post-01", DEMO_IDS.june, 1),
  like("demo-post-01", DEMO_IDS.arthur, 2), like("demo-post-01", DEMO_IDS.margot, 1),
  like("demo-post-02", DEMO_IDS.arthur, 40), like("demo-post-02", DEMO_IDS.ines, 30),
  like("demo-post-03", DEMO_IDS.tomas, 100), like("demo-post-03", DEMO_IDS.margot, 90),
  like("demo-post-05", DEMO_IDS.elena, 4), like("demo-post-05", DEMO_IDS.sam, 3),
  like("demo-post-06", DEMO_IDS.elena, 60), like("demo-post-06", DEMO_IDS.june, 50),
  like("demo-post-06", DEMO_IDS.niko, 40),
  like("demo-post-08", DEMO_IDS.elena, 6), like("demo-post-08", DEMO_IDS.ines, 5),
  like("demo-post-09", DEMO_IDS.tomas, 80),
  like("demo-post-12", DEMO_IDS.elena, 20), like("demo-post-12", DEMO_IDS.margot, 18),
  like("demo-post-15", DEMO_IDS.june, 8), like("demo-post-15", DEMO_IDS.otis, 7),
  like("demo-post-15", DEMO_IDS.sam, 6),
  like("demo-post-18", DEMO_IDS.clara, 12),
  like("demo-post-19", DEMO_IDS.sam, 120),
  like("demo-post-21", DEMO_IDS.arthur, 24), like("demo-post-21", DEMO_IDS.elena, 20),
  like("demo-post-23", DEMO_IDS.tomas, 2), like("demo-post-23", DEMO_IDS.clara, 2),
  like("demo-post-23", DEMO_IDS.otis, 1),
  like("demo-post-26", DEMO_IDS.june, 16), like("demo-post-26", DEMO_IDS.margot, 14),
  like("demo-post-26", DEMO_IDS.niko, 12),
  like("demo-post-29", DEMO_IDS.elena, 10), like("demo-post-29", DEMO_IDS.ines, 8),
];

const comment = (id: string, postId: string, authorId: string, body: string, h: number): CommentRow => ({
  id,
  post_id: postId,
  author_id: authorId,
  body,
  created_at: hoursAgo(h),
  removed_at: null,
  removed_by: null,
});

export const DEMO_COMMENTS: CommentRow[] = [
  comment("demo-comment-01", "demo-post-01", DEMO_IDS.arthur, "That light. Milan forgives everything at this hour.", 1.5),
  comment("demo-comment-02", "demo-post-01", DEMO_IDS.tomas, "The emptiness makes it.", 1.2),
  comment("demo-comment-03", "demo-post-02", DEMO_IDS.ines, "Please never let anyone renovate this.", 40),
  comment("demo-comment-04", "demo-post-05", DEMO_IDS.elena, "Alpine was made for your city.", 4),
  comment("demo-comment-05", "demo-post-06", DEMO_IDS.june, "The stillness travels. Thank you for this.", 48),
  comment("demo-comment-06", "demo-post-08", DEMO_IDS.elena, "I can smell the rain from here.", 6),
  comment("demo-comment-07", "demo-post-12", DEMO_IDS.margot, "Forty years and he still carries four cups at once, I hope.", 20),
  comment("demo-comment-08", "demo-post-15", DEMO_IDS.otis, "Walls with memory. My kind of subject.", 8),
  comment("demo-comment-09", "demo-post-19", DEMO_IDS.clara, "You CAN hear it. Wonderful.", 120),
  comment("demo-comment-10", "demo-post-21", DEMO_IDS.arthur, "The good one is worth the wait.", 24),
  comment("demo-comment-11", "demo-post-23", DEMO_IDS.tomas, "The stillness in the rush — you found it again.", 2),
  comment("demo-comment-12", "demo-post-26", DEMO_IDS.june, "Blue and blue and blue. Lovely.", 18),
  comment("demo-comment-13", "demo-post-29", DEMO_IDS.ines, "Give the committee my regards.", 10),
];

export const DEMO_APPLICATIONS: ApplicationRow[] = [
  {
    id: "demo-app-ruby",
    user_id: DEMO_IDS.ruby,
    full_name: "Ruby Calloway",
    desired_username: "ruby.calloway",
    avatar_url: face("ruby-face"),
    social_handle: "@rubyshoots",
    city: "Portland",
    inviter: "elena.marchetti",
    reason:
      "I shoot medium format landscapes and my grandmother’s garden every Sunday. I miss when sharing photos felt like showing someone a print.",
    status: "pending",
    decided_by: null,
    decided_at: null,
    created_at: daysAgo(3),
  },
  {
    id: "demo-app-dex",
    user_id: DEMO_IDS.dex,
    full_name: "Dex Morrow",
    desired_username: "dex.morrow",
    avatar_url: null,
    social_handle: "@dexmorrow",
    city: "Chicago",
    inviter: null,
    reason: "Mostly night photography on expired film stock. Looking for a smaller room to share it in.",
    status: "pending",
    decided_by: null,
    decided_at: null,
    created_at: daysAgo(1),
  },
];

export const DEMO_INVITES: InviteRow[] = [
  {
    id: "demo-invite-1",
    code: "ELNA-M4RC",
    created_by: DEMO_IDS.elena,
    used_by: DEMO_IDS.niko,
    created_at: daysAgo(70),
    used_at: daysAgo(59),
  },
  {
    id: "demo-invite-2",
    code: "QUET-R2OM",
    created_by: DEMO_IDS.elena,
    used_by: null,
    created_at: daysAgo(20),
    used_at: null,
  },
  {
    id: "demo-invite-3",
    code: "JNKA-K7YT",
    created_by: DEMO_IDS.june,
    used_by: null,
    created_at: daysAgo(12),
    used_at: null,
  },
];

export const DEMO_REPORTS: ReportRow[] = [
  {
    id: "demo-report-1",
    reporter_id: DEMO_IDS.margot,
    target_type: "post",
    post_id: "demo-post-20",
    comment_id: null,
    profile_id: null,
    reason: "Promotional or engagement-bait content",
    details: "The caption feels like an ad for a tour company. Might be nothing.",
    status: "open",
    resolution_note: null,
    resolved_by: null,
    resolved_at: null,
    created_at: hoursAgo(20),
  },
];

export const DEMO_ACTIVITY: ActivityRow[] = [];
