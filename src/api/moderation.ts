import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import type {
  ApplicationRow,
  ApplicationStatus,
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

/** Admin: applications queue. */
export async function fetchApplications(status: ApplicationStatus): Promise<ApplicationRow[]> {
  if (isDemoMode()) return demo.demoFetchApplications(status);

  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ApplicationRow[];
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

/** Admin: reports queue. */
export interface ReportWithRefs extends ReportRow {
  reporter: Pick<ProfileRow, "id" | "username"> | null;
}

export async function fetchReports(status: ReportStatus): Promise<ReportWithRefs[]> {
  if (isDemoMode()) return demo.demoFetchReports(status);

  const { data, error } = await supabase
    .from("reports")
    .select("*, reporter:profiles!reports_reporter_id_fkey(id, username)")
    .eq("status", status)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ReportWithRefs[];
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
