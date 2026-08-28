/**
 * Database types for the VINTAGE Supabase schema.
 *
 * Hand-maintained to mirror supabase/migrations. Once you have a running
 * Supabase project you can regenerate this file with:
 *
 *   npx supabase gen types typescript --local > src/types/db.generated.ts
 *
 * and swap the import. The shapes below intentionally match what the
 * generator emits so the swap is mechanical.
 */

export type MembershipStatus =
  | "applied"
  | "waitlisted"
  | "approved"
  | "rejected"
  | "suspended";

export type ApplicationStatus = "pending" | "approved" | "waitlisted" | "rejected";

export type MediaType = "photo" | "video";

export type ActivityType = "like" | "comment" | "follow" | "moderation";

export type ReportTargetType = "post" | "comment" | "profile";

export type ReportStatus = "open" | "resolved" | "dismissed";

export type ModerationActionType =
  | "warning"
  | "suspension"
  | "reinstatement"
  | "post_removal"
  | "comment_removal";

export type ProfileRow = {
  id: string;
  username: string;
  full_name: string | null;
  bio: string;
  avatar_url: string | null;
  city: string | null;
  social_handle: string | null;
  role: "member" | "admin";
  status: MembershipStatus;
  invite_quota: number;
  post_count: number;
  follower_count: number;
  following_count: number;
  created_at: string;
  approved_at: string | null;
}

export type ApplicationRow = {
  id: string;
  user_id: string;
  full_name: string;
  desired_username: string;
  avatar_url: string | null;
  social_handle: string | null;
  city: string | null;
  inviter: string | null;
  reason: string;
  status: ApplicationStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export type InviteRow = {
  id: string;
  code: string;
  created_by: string;
  used_by: string | null;
  created_at: string;
  used_at: string | null;
}

export type FollowRow = {
  follower_id: string;
  followee_id: string;
  created_at: string;
}

export type PostRow = {
  id: string;
  author_id: string;
  media_type: MediaType;
  media_path: string;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  filter_id: string;
  show_date_stamp: boolean;
  caption: string;
  like_count: number;
  comment_count: number;
  created_at: string;
  removed_at: string | null;
  removed_by: string | null;
}

export type LikeRow = {
  post_id: string;
  user_id: string;
  created_at: string;
}

export type CommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  removed_at: string | null;
  removed_by: string | null;
}

export type ActivityRow = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  type: ActivityType;
  post_id: string | null;
  comment_id: string | null;
  message: string | null;
  created_at: string;
  read_at: string | null;
}

export type ReportRow = {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  post_id: string | null;
  comment_id: string | null;
  profile_id: string | null;
  reason: string;
  details: string | null;
  status: ReportStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export type ModerationActionRow = {
  id: string;
  admin_id: string;
  target_profile_id: string;
  action: ModerationActionType;
  post_id: string | null;
  comment_id: string | null;
  note: string;
  created_at: string;
}

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      applications: Table<ApplicationRow>;
      invites: Table<InviteRow>;
      follows: Table<FollowRow>;
      posts: Table<PostRow>;
      likes: Table<LikeRow>;
      comments: Table<CommentRow>;
      activity: Table<ActivityRow>;
      reports: Table<ReportRow>;
      moderation_actions: Table<ModerationActionRow>;
    };
    Views: Record<string, never>;
    Functions: {
      redeem_invite: {
        Args: { p_code: string };
        Returns: boolean;
      };
      create_invite: {
        Args: Record<string, never>;
        Returns: string;
      };
      decide_application: {
        Args: { p_application_id: string; p_decision: ApplicationStatus };
        Returns: undefined;
      };
      admin_warn_member: {
        Args: { p_profile_id: string; p_note: string };
        Returns: undefined;
      };
      admin_set_suspension: {
        Args: { p_profile_id: string; p_suspended: boolean; p_note: string };
        Returns: undefined;
      };
      admin_remove_post: {
        Args: { p_post_id: string; p_note: string };
        Returns: undefined;
      };
      admin_remove_comment: {
        Args: { p_comment_id: string; p_note: string };
        Returns: undefined;
      };
      resolve_report: {
        Args: { p_report_id: string; p_status: ReportStatus; p_note: string };
        Returns: undefined;
      };
      username_available: {
        Args: { p_username: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** A post joined with its author profile, as fetched for feeds and grids. */
export type PostWithAuthor = PostRow & {
  author: Pick<ProfileRow, "id" | "username" | "full_name" | "avatar_url">;
};

/** A comment joined with its author profile. */
export type CommentWithAuthor = CommentRow & {
  author: Pick<ProfileRow, "id" | "username" | "avatar_url">;
};

/** An activity item joined with actor and post preview. */
export type ActivityWithRefs = ActivityRow & {
  actor: Pick<ProfileRow, "id" | "username" | "avatar_url"> | null;
  post: Pick<PostRow, "id" | "media_path" | "thumb_path" | "media_type"> | null;
};
