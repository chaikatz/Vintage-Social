import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import { prepareAvatar, uploadFile } from "./media";
import { normalizeUsername } from "@/utils/validation";
import type { ApplicationRow, InviteRow } from "@/types/db";

/**
 * Membership flows. New accounts are created in `applied` status by a
 * database trigger; only an admin decision or a valid invite moves them to
 * `approved`. In demo mode the same flows run against the in-memory store.
 */

export interface ApplicationInput {
  email: string;
  password: string;
  fullName: string;
  desiredUsername: string;
  avatarUri: string | null;
  socialHandle: string;
  city: string;
  inviter: string;
  reason: string;
}

export async function checkUsernameAvailable(username: string): Promise<boolean> {
  if (isDemoMode()) return demo.demoUsernameAvailable(normalizeUsername(username));

  const { data, error } = await supabase.rpc("username_available", {
    p_username: normalizeUsername(username),
  });
  if (error) throw error;
  return Boolean(data);
}

async function signUp(email: string, password: string, username: string, fullName: string) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { username: normalizeUsername(username), full_name: fullName.trim() },
    },
  });
  if (error) throw error;
  const user = data.user;
  if (!user) throw new Error("Sign-up did not return a user. Check email confirmation settings.");
  return user;
}

export async function submitApplication(input: ApplicationInput): Promise<void> {
  if (isDemoMode()) {
    demo.demoSubmitApplication({
      fullName: input.fullName.trim(),
      desiredUsername: normalizeUsername(input.desiredUsername),
      avatarUri: input.avatarUri,
      socialHandle: input.socialHandle.trim(),
      city: input.city.trim(),
      inviter: input.inviter.trim(),
      reason: input.reason.trim(),
    });
    return;
  }

  const user = await signUp(input.email, input.password, input.desiredUsername, input.fullName);

  let avatarPath: string | null = null;
  if (input.avatarUri) {
    const avatar = await prepareAvatar(input.avatarUri);
    avatarPath = await uploadFile("avatars", `${user.id}/avatar.jpg`, avatar.uri, "image/jpeg");
    await supabase.from("profiles").update({ avatar_url: avatarPath }).eq("id", user.id);
  }

  const { error } = await supabase.from("applications").insert({
    user_id: user.id,
    full_name: input.fullName.trim(),
    desired_username: normalizeUsername(input.desiredUsername),
    avatar_url: avatarPath,
    social_handle: input.socialHandle.trim() || null,
    city: input.city.trim() || null,
    inviter: input.inviter.trim() || null,
    reason: input.reason.trim(),
  });
  if (error) throw error;
}

export interface InviteSignupInput {
  email: string;
  password: string;
  fullName: string;
  desiredUsername: string;
  code: string;
}

/** Create an account and redeem an invite in one flow → instant approval. */
export async function joinWithInvite(input: InviteSignupInput): Promise<void> {
  if (isDemoMode()) {
    demo.demoJoinWithInvite({
      fullName: input.fullName.trim(),
      desiredUsername: normalizeUsername(input.desiredUsername),
    });
    return;
  }

  await signUp(input.email, input.password, input.desiredUsername, input.fullName);
  const { data, error } = await supabase.rpc("redeem_invite", { p_code: input.code });
  if (error) throw error;
  if (!data) throw new Error("That invite code is invalid or already used.");
}

export async function fetchMyApplication(userId: string): Promise<ApplicationRow | null> {
  if (isDemoMode()) return demo.demoFetchMyApplication(userId);

  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ApplicationRow | null) ?? null;
}

export async function fetchMyInvites(userId: string): Promise<InviteRow[]> {
  if (isDemoMode()) return demo.demoFetchMyInvites(userId);

  const { data, error } = await supabase
    .from("invites")
    .select("*")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as InviteRow[];
}

/** Mint a new invite code, limited server-side by the member's quota. */
export async function createInvite(): Promise<string> {
  if (isDemoMode()) return demo.demoCreateInvite();

  const { data, error } = await supabase.rpc("create_invite", {});
  if (error) throw error;
  return data as string;
}
