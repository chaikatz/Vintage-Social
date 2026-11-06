import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import { demoKeysetPage, pageAfter, type Cursor } from "./keyset";
import type {
  ApplicationRow,
  ApplicationStatus,
  CommentRow,
  ModerationActionRow,
  ProfileRow,
  ReportRow,
  ReportStatus,
  ReportTargetType,
} from "@/types/db";

/** Member-facing reporting. */
export interface ReportInput {
  reporterId: string;
  targetType: ReportTargetType;
  postId?: string;
  commentId?: string;
  profileId?: string;
  reason: string;
  details?: string;
}

export const REPORT_REASONS = [
  "Promotional or engagement-bait content",
  "Harassment or abuse",
  "Not their own work",
  "Explicit or unsafe content",
  "Spam or scam",
  "Something else",
] as const;

export async function submitReport(input: ReportInput): Promise<void> {
  if (isDemoMode()) {
    demo.demoSubmitReport({
      reporter_id: input.reporterId,
      target_type: input.targetType,
      post_id: input.postId ?? null,
      comment_id: input.commentId ?? null,
      profile_id: input.profileId ?? null,
      reason: input.reason,
      details: input.details?.trim() || null,
    });
    return;
  }
  const { error } = await supabase.from("reports").insert({
    reporter_id: input.reporterId,
    target_type: input.targetType,
    post_id: input.postId ?? null,
    comment_id: input.commentId ?? null,
    profile_id: input.profileId ?? null,
    reason: input.reason,
    details: input.details?.trim() || null,
  });
  if (error) throw error;
}

/** How many rows of a queue an admin screen reads at a time. */
export const ADMIN_PAGE_SIZE = 50;

/**
 * Where the next page of a queue starts: the last row held (./keyset).
 * A queue still to be worked through (applications pending or on the
 * waitlist, open reports) reads oldest first, the order it is worked in;
 * a record of what was decided reads newest first, so the latest is what
 * a page shows rather than the first decisions ever made.
 */
export type AdminCursor = Cursor;

/** The cursor after a page of a queue: its last row, or none when the page ended it. */
export function nextAdminCursor(page: { id: string; created_at: string }[]): AdminCursor | undefined {
  if (page.length < ADMIN_PAGE_SIZE) return undefined;
  const last = page[page.length - 1];
  return { at: last.created_at, id: last.id };
}

const OLDEST_FIRST: ReadonlySet<string> = new Set(["pending", "waitlisted", "open"]);

/**
 * Admin: applications, a page at a time. Every application with that
 * status was read in one request, every column, and PostgREST stops a
 * read at a thousand rows without saying so.
 */
export async function fetchApplications(
  status: ApplicationStatus,
  after: AdminCursor | null = null,
): Promise<ApplicationRow[]> {
  if (isDemoMode()) return demoPageOf(demo.demoFetchApplications(status), status, after);

  const ascending = OLDEST_FIRST.has(status);
  const query = supabase.from("applications").select("*").eq("status", status);
  const { data, error } = await pageAfter(query, "created_at", "id", after, ascending)
    .order("created_at", { ascending })
    .order("id", { ascending })
    .limit(ADMIN_PAGE_SIZE);
  if (error) throw error;
  return (data ?? []) as ApplicationRow[];
}

/** Admin: how many applications have this status, counted by the database without reading one. */
export async function countApplications(status: ApplicationStatus): Promise<number> {
  if (isDemoMode()) return demo.demoFetchApplications(status).length;
  const { count, error } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw error;
  return count ?? 0;
}

/** The demo's queues, in the order the database would give them, a page at a time. */
function demoPageOf<T extends { id: string; created_at: string }>(rows: T[], status: string, after: AdminCursor | null): T[] {
  return demoKeysetPage(rows, (r) => ({ at: r.created_at, id: r.id }), after, ADMIN_PAGE_SIZE, OLDEST_FIRST.has(status));
}

export async function decideApplication(
  applicationId: string,
  decision: Exclude<ApplicationStatus, "pending">,
): Promise<void> {
  if (isDemoMode()) {
    demo.demoDecideApplication(applicationId, decision);
    return;
  }
  const { error } = await supabase.rpc("decide_application", {
    p_application_id: applicationId,
    p_decision: decision,
  });
  if (error) throw error;
}

/** A reported comment as the admin sees it: what was said, where, and by whom. */
export type ReportedComment = Pick<CommentRow, "id" | "body" | "post_id" | "removed_at"> & {
  author: Pick<ProfileRow, "id" | "username"> | null;
};

/** Admin: reports queue. */
export interface ReportWithRefs extends ReportRow {
  reporter: Pick<ProfileRow, "id" | "username"> | null;
  /** For a comment report: the comment itself, so it is never removed unseen. */
  comment?: ReportedComment | null;
  /** For a member report: who, by name, to open their profile. */
  member?: Pick<ProfileRow, "id" | "username"> | null;
}

/**
 * Admin: reports, a page at a time. With each, the reporter's name, and
 * for a reported comment its words, the photograph it is on and who wrote
 * it, and for a reported member their name: an admin used to remove a
 * comment without seeing it, and open a member by id. A reference the
 * admin cannot read (a comment deleted since) comes back empty.
 */
export async function fetchReports(status: ReportStatus, after: AdminCursor | null = null): Promise<ReportWithRefs[]> {
  if (isDemoMode()) return demoPageOf(demo.demoFetchReports(status), status, after);

  const ascending = OLDEST_FIRST.has(status);
  const query = supabase
    .from("reports")
    .select(
      "*, reporter:profiles!reports_reporter_id_fkey(id, username)" +
        ", comment:comments!reports_comment_id_fkey(id, body, post_id, removed_at, author:profiles!comments_author_id_fkey(id, username))" +
        ", member:profiles!reports_profile_id_fkey(id, username)",
    )
    .eq("status", status);
  const { data, error } = await pageAfter(query, "created_at", "id", after, ascending)
    .order("created_at", { ascending })
    .order("id", { ascending })
    .limit(ADMIN_PAGE_SIZE);
  if (error) throw error;
  return (data ?? []) as unknown as ReportWithRefs[];
}

/** Admin: how many reports have this status, counted by the database without reading one. */
export async function countReports(status: ReportStatus): Promise<number> {
  if (isDemoMode()) return demo.demoFetchReports(status).length;
  const { count, error } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw error;
  return count ?? 0;
}

export async function resolveReport(
  reportId: string,
  status: Exclude<ReportStatus, "open">,
  note: string,
): Promise<void> {
  if (isDemoMode()) {
    demo.demoResolveReport(reportId, status, note);
    return;
  }
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: reportId,
    p_status: status,
    p_note: note,
  });
  if (error) throw error;
}

/**
 * Admin actions. Moderation is always a deliberate human decision — there is
 * no automated banning anywhere in VINTAGE.
 */
export async function warnMember(profileId: string, note: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoWarnMember(profileId, note);
    return;
  }
  const { error } = await supabase.rpc("admin_warn_member", {
    p_profile_id: profileId,
    p_note: note,
  });
  if (error) throw error;
}

export async function setSuspension(
  profileId: string,
  suspended: boolean,
  note: string,
): Promise<void> {
  if (isDemoMode()) {
    demo.demoSetSuspension(profileId, suspended, note);
    return;
  }
  const { error } = await supabase.rpc("admin_set_suspension", {
    p_profile_id: profileId,
    p_suspended: suspended,
    p_note: note,
  });
  if (error) throw error;
}

export async function removePost(postId: string, note: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoRemovePost(postId, note);
    return;
  }
  const { error } = await supabase.rpc("admin_remove_post", { p_post_id: postId, p_note: note });
  if (error) throw error;
}

export async function removeComment(commentId: string, note: string): Promise<void> {
  if (isDemoMode()) {
    demo.demoRemoveComment(commentId, note);
    return;
  }
  const { error } = await supabase.rpc("admin_remove_comment", {
    p_comment_id: commentId,
    p_note: note,
  });
  if (error) throw error;
}

export async function fetchModerationLog(): Promise<ModerationActionRow[]> {
  if (isDemoMode()) return demo.demoFetchModerationLog();

  const { data, error } = await supabase
    .from("moderation_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as ModerationActionRow[];
}

export async function fetchMembers(q: string): Promise<ProfileRow[]> {
  if (isDemoMode()) return demo.demoFetchMembers(q);

  let query = supabase.from("profiles").select("*").order("created_at", { ascending: false });
  const needle = q.trim();
  if (needle) {
    const escaped = needle.replace(/[%_\\]/g, "\\$&").replace(/,/g, "");
    query = query.or(`username.ilike.%${escaped}%,full_name.ilike.%${escaped}%`);
  }
  const { data, error } = await query.limit(50);
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

/** Admin: read the number every new member is given. */
export async function fetchDefaultInviteQuota(): Promise<number> {
  if (isDemoMode()) return 5;
  const { data, error } = await supabase.rpc("default_invite_quota", {});
  if (error) throw error;
  return Number(data ?? 5);
}

/** Admin: set the number every new member is given from now on. */
export async function setDefaultInviteQuota(quota: number): Promise<number> {
  if (isDemoMode()) return quota;
  const { data, error } = await supabase.rpc("admin_set_default_invite_quota", { p_quota: quota });
  if (error) throw error;
  return Number(data);
}

/** Admin: give one member a new allowance. */
export async function setInviteQuota(profileId: string, quota: number): Promise<number> {
  if (isDemoMode()) {
    demo.demoSetInviteQuota(profileId, quota);
    return quota;
  }
  const { data, error } = await supabase.rpc("admin_set_invite_quota", { p_profile_id: profileId, p_quota: quota });
  if (error) throw error;
  return Number(data);
}
