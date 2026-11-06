import { isAbortError, isTransient } from "./retry";

/**
 * Words for an alert, from whatever was thrown.
 *
 * Supabase hands back its errors as plain objects rather than Errors: a
 * refused request comes back as `{ code, message, details, hint }`, parsed
 * straight from the response. `err instanceof Error ? err.message :
 * String(err)` turned every one of them into "[object Object]", which is
 * what a member saw when a photograph would not delete. The message inside
 * is no better for them: it is the database talking ('new row for
 * relation "messages" violates check constraint …').
 *
 * So an alert says one of four things. A sentence our own SQL raised for
 * the member (RAISE EXCEPTION, SQLSTATE P0001: "You are the only admin.
 * Make another member an admin before deleting this account."). A sentence
 * our own code threw ("Only the author can delete a post."). A refusal
 * Supabase Auth wrote for the person signing in or up ("Invalid login
 * credentials"). Otherwise the caller's own words for what did not
 * happen. Never the database's text, a status, a stack, or an object
 * printed as text.
 */

/** The SQLSTATE of RAISE EXCEPTION without one of its own: our functions' words for the member. */
const RAISED = "P0001";

/** What gives away the database, the network stack or the runtime rather than a person. */
const TECHNICAL =
  /\[object |violates|constraint|relation "|column "|permission denied|row-level security|duplicate key|null value|syntax error|invalid input|PGRST|JWT|SQLSTATE|TypeError|ReferenceError|undefined is not|is not a function|evaluating '|status code/i;

/** A mistake in the code, whatever its message says. */
const RUNTIME = /^(TypeError|ReferenceError|SyntaxError|RangeError)$/;

/** The text an error carries, wherever it keeps it. Never `String()` of an object. */
export function messageOf(err: unknown): string {
  if (typeof err === "string") return err.trim();
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return "";
}

/**
 * Whether it came back from a server (PostgREST, Storage, Auth) rather than
 * from our own code. We never throw plain objects, so any is the server's;
 * an Error is one when it carries the server's code or status, as
 * PostgrestError, StorageApiError and AuthError do. Every one of auth-js's
 * errors is Auth's, whether or not it has a status: AuthUnknownError
 * carries none, and its message is a parser's ("Unexpected token <").
 */
function fromServer(err: object): boolean {
  if (!(err instanceof Error)) return true;
  const e = err as unknown as Record<string, unknown>;
  if (e.__isAuthError === true) return true;
  return ["code", "status", "statusCode"].some((key) => e[key] != null && e[key] !== "");
}

function codeOf(err: object): string {
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/**
 * Supabase Auth's refusals are written for the person at the door:
 * "Invalid login credentials", "User already registered", a password's
 * reason for being too weak (AuthWeakPasswordError, 422). They carry a
 * status, as every server's error does, and so used to turn into the
 * fallback: a wrong password at Sign in read "Check your connection".
 *
 * Only a refusal: auth-js's AuthApiError or AuthWeakPasswordError, with a
 * 4xx status that is not a timeout (408) or too many tries (429). Not its
 * outages and states, which have names of their own and say nothing a
 * person can act on (AuthRetryableFetchError, AuthUnknownError,
 * "Auth session missing!"), nor a refusal about the session's own tokens
 * rather than what was typed ("Invalid Refresh Token: Already Used").
 */
const AUTH_REFUSALS: ReadonlySet<string> = new Set(["AuthApiError", "AuthWeakPasswordError"]);
const AUTH_MECHANICS = /^(refresh_token|session_|bad_|no_authorization|flow_state|unexpected_failure|request_timeout|invalid_jwt)/;

function isAuthRefusal(err: object): boolean {
  const e = err as { __isAuthError?: unknown; name?: unknown; status?: unknown };
  if (e.__isAuthError !== true || !AUTH_REFUSALS.has(String(e.name))) return false;
  const status = Number(e.status);
  if (!(status >= 400 && status < 500) || status === 408 || status === 429) return false;
  return !AUTH_MECHANICS.test(codeOf(err));
}

/** The member's words for what went wrong: the error's own, when it has any fit to show, else `fallback`. */
export function errorMessage(err: unknown, fallback: string): string {
  const text = messageOf(err);
  if (!text || TECHNICAL.test(text)) return fallback;
  if (err && typeof err === "object") {
    // A dropped connection or a request called off says nothing the
    // fallback does not say better.
    if (isAbortError(err) || isTransient(err)) return fallback;
    if (err instanceof Error && RUNTIME.test(err.name)) return fallback;
    if (fromServer(err) && codeOf(err) !== RAISED && !isAuthRefusal(err)) return fallback;
  }
  return text;
}
