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
 * So an alert says one of three things. A sentence our own SQL raised for
 * the member (RAISE EXCEPTION, SQLSTATE P0001: "You are the only admin.
 * Make another member an admin before deleting this account."). A sentence
 * our own code threw ("Only the author can delete a post."). Otherwise the
 * caller's own words for what did not happen. Never the database's text, a
 * status, a stack, or an object printed as text.
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
 * PostgrestError, StorageApiError and AuthError do.
 */
function fromServer(err: object): boolean {
  if (!(err instanceof Error)) return true;
  const e = err as unknown as Record<string, unknown>;
  return ["code", "status", "statusCode"].some((key) => e[key] != null && e[key] !== "");
}

function codeOf(err: object): string {
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
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
    if (fromServer(err) && codeOf(err) !== RAISED) return fallback;
  }
  return text;
}
