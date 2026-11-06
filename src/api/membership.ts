import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import { prepareAvatar, uploadFile } from "./media";
import { normalizeUsername } from "@/utils/validation";
import type { ApplicationRow } from "@/types/db";
import { asRedeemResult, describeRedeem, type RedeemResult } from "@/utils/invitationReasons";

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

/** The email and password typed on the form beside the name. */
export interface TypedAccount {
  email: string;
  password: string;
}

/** The username of the account this phone is signed in to, if any. */
async function signedInUsername(): Promise<string | null> {
  const { data: auth } = await supabase.auth.getSession();
  const me = auth.session?.user;
  if (!me) return null;
  const { data: mine } = await supabase.from("profiles").select("username").eq("id", me.id).maybeSingle();
  return (mine?.username as string | undefined) ?? null;
}

/**
 * Whether a username is free. One taken by the person's own account is
 * theirs: a sign-up that failed part-way has already made the account,
 * with that name, and trying again must not be told it is taken.
 *
 * Their own account is the one signed in, or, when nobody is signed in
 * (the first try's answer never came back, so no session was kept), the
 * one the email and password typed beside the name open. That sign-in
 * is kept only when the name is that account's own, for the sign-up to
 * carry on with; any other account it opened is signed out of again, and
 * the name is taken.
 */
export async function checkUsernameAvailable(username: string, typed?: TypedAccount): Promise<boolean> {
  const name = normalizeUsername(username);
  if (isDemoMode()) return demo.demoUsernameAvailable(name);

  const { data, error } = await supabase.rpc("username_available", { p_username: name });
  if (error) throw error;
  if (data) return true;

  const { data: auth } = await supabase.auth.getSession();
  const current = auth.session?.user;
  if (current) {
    // Signed in to another email's account: the sign-up makes a new one,
    // and this name is not free for it.
    if (typed && (current.email ?? "").toLowerCase() !== typed.email.trim().toLowerCase()) return false;
    return (await signedInUsername()) === name;
  }
  if (!typed || !typed.email.trim() || !typed.password) return false;
  const { data: opened, error: refused } = await supabase.auth.signInWithPassword({
    email: typed.email.trim(),
    password: typed.password,
  });
  if (refused || !opened.user) return false;
  if ((await signedInUsername()) === name) return true;
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  return false;
}

/** What the Apply form says to an email whose account is past the door. */
export const ACCOUNT_EXISTS = "This email already has an account. Sign in instead.";

/** "User already registered": the email has an account already. */
function alreadyRegistered(error: { message?: string; code?: string } | null | undefined): boolean {
  return Boolean(error) && (error!.code === "user_already_exists" || /already registered/i.test(error!.message ?? ""));
}

/**
 * The account for this sign-up: the one a previous try of it made, when
 * that try got as far as making it, or a new one.
 *
 * Applying and joining by invitation each make the account first and then
 * do more (a portrait, the application, the invitation). When a later step
 * failed (the signal went), trying again began by making the account
 * again, and was refused: "User already registered". Now the account the
 * person is signed in to is used when it is the same email; and when the
 * email is refused as taken, the password they typed is tried on it, so
 * the person who made it a minute ago carries on where they stopped. A
 * password that does not open it is the original refusal, unchanged.
 */
async function signUpOrResume(email: string, password: string, username: string, fullName: string) {
  const wanted = email.trim().toLowerCase();
  const { data: auth } = await supabase.auth.getSession();
  const current = auth.session?.user;
  if (current && (current.email ?? "").toLowerCase() === wanted) return current;
  try {
    return await signUp(email, password, username, fullName);
  } catch (err) {
    if (!alreadyRegistered(err as { message?: string; code?: string })) throw err;
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) throw err;
    return data.user;
  }
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

  const user = await signUpOrResume(input.email, input.password, input.desiredUsername, input.fullName);

  // Only an account still at the door ("applied") has a sign-up to finish.
  // Any other the email and password open is already known: a member let
  // in (by invitation, with no application of their own), a suspended
  // one, or one waitlisted or turned down. An application from it would
  // put a new portrait over theirs and, approved by an admin who sees only
  // the name typed, could let in again whoever it is. Nothing is uploaded
  // or filed, and the session this opened is ended.
  const { data: account, error: accountError } = await supabase
    .from("profiles")
    .select("username, status")
    .eq("id", user.id)
    .maybeSingle();
  if (accountError) throw accountError;
  if (account?.status !== "applied") {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    throw new Error(ACCOUNT_EXISTS);
  }

  // A previous try that filed the application has nothing left to do.
  if (await fetchMyApplication(user.id)) return;

  let avatarPath: string | null = null;
  if (input.avatarUri) {
    const avatar = await prepareAvatar(input.avatarUri);
    avatarPath = await uploadFile("avatars", `${user.id}/avatar.jpg`, avatar.uri, "image/jpeg", {
      upsert: true,
    });
    await supabase.from("profiles").update({ avatar_url: avatarPath }).eq("id", user.id);
  }

  const { error } = await supabase.from("applications").insert({
    user_id: user.id,
    full_name: input.fullName.trim(),
    // The name the account has: an approval lets in the account, under
    // the name its first try gave it, whatever was typed this time.
    desired_username: (account.username as string | null) ?? normalizeUsername(input.desiredUsername),
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

export { describeRedeem };
export type { RedeemResult };

/**
 * Take up an invitation with the account you are signed in to. Safe to
 * call again: a member who already joined is told so and nothing is spent.
 */
export async function redeemInviteLink(slug: string): Promise<RedeemResult> {
  if (isDemoMode()) return demo.demoRedeemInviteLink(slug);
  const { data, error } = await supabase.rpc("redeem_invite_link", { p_slug: slug });
  if (error) throw error;
  return asRedeemResult(String(data));
}

/** Create an account and take up an invitation in one flow → instant approval. */
export async function joinWithInvite(input: InviteSignupInput): Promise<void> {
  if (isDemoMode()) {
    demo.demoJoinWithInvite({
      fullName: input.fullName.trim(),
      desiredUsername: normalizeUsername(input.desiredUsername),
      code: input.code,
    });
    return;
  }

  // A previous try may have made the account and failed at the invitation:
  // it carries on with that account. Taking up an invitation again with an
  // account already in is answered as done, and nothing is spent twice.
  await signUpOrResume(input.email, input.password, input.desiredUsername, input.fullName);
  const result = await redeemInviteLink(input.code);
  const problem = describeRedeem(result);
  if (problem) {
    // The account exists but is not a member: it waits as an application
    // would, and the code can be entered again from the waiting screen.
    throw new Error(problem + " Your account has been created; enter a valid invitation to join.");
  }
}

/**
 * Who is behind an invitation, asked before the recipient has an account.
 *
 * Answers for anon, and deliberately says almost nothing: a display name
 * and whether the door is open. An unknown link and a spent one look the
 * same from here.
 */
export interface InviteOwner {
  inviter: string | null;
  open: boolean;
}

export async function fetchInviteOwner(slug: string): Promise<InviteOwner> {
  if (isDemoMode()) return demo.demoInviteOwner(slug);

  const { data, error } = await supabase.rpc("invite_link_owner", { p_slug: slug });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { inviter: row?.inviter ?? null, open: Boolean(row?.open) };
}

/** A member's own invitation link, made on first use. */
export interface InviteLink {
  slug: string;
  allowance: number;
  used: number;
}

export async function fetchInviteLink(): Promise<InviteLink> {
  if (isDemoMode()) return demo.demoInviteLink();

  const { data, error } = await supabase.rpc("ensure_invite_link", {});
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    slug: String(row?.slug ?? ""),
    allowance: Number(row?.allowance ?? 0),
    used: Number(row?.used ?? 0),
  };
}

/** Give the link a suffix of the member's choosing. */
export async function setInviteSlug(slug: string): Promise<string> {
  if (isDemoMode()) return demo.demoSetInviteSlug(slug);

  const { data, error } = await supabase.rpc("set_invite_slug", { p_slug: slug });
  if (error) throw error;
  return String(data);
}

/** Retire the current address and issue a new one. */
export async function rotateInviteLink(): Promise<string> {
  if (isDemoMode()) return demo.demoRotateInviteLink();

  const { data, error } = await supabase.rpc("rotate_invite_link", {});
  if (error) throw error;
  return String(data);
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


