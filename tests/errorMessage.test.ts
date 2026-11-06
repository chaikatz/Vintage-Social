import { describe, expect, it } from "vitest";
import { errorMessage, messageOf } from "@/utils/errorMessage";
import { TimeoutError, abortError } from "@/utils/retry";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js";
import { code } from "./helpers/screenSource";

// The screens' text only: src/api/membership.ts imports the Supabase client.
const ACCOUNT_EXISTS = code("src/api/membership.ts").match(/export const ACCOUNT_EXISTS = "([^"]+)";/)![1];

/**
 * What an alert says for whatever was thrown. The case that started it:
 * supabase-js returns a refused request as a plain object, and the
 * post-delete alert printed it as "[object Object]".
 */

const FALLBACK = "Nothing was removed. Try again in a moment.";

/** A refused request exactly as postgrest-js hands it back: JSON.parse of the body, not an Error. */
const postgrest = (code: string, message: string) => ({ code, message, details: null, hint: null });

describe("what a member is shown", () => {
  it("never shows an object printed as text", () => {
    const refused = postgrest("23514", 'new row for relation "messages" violates check constraint "messages_check"');
    expect(String(refused)).toBe("[object Object]");
    expect(errorMessage(refused, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage({}, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage({ message: { nested: true } }, FALLBACK)).toBe(FALLBACK);
  });

  it("never shows the database talking", () => {
    for (const refused of [
      postgrest("23514", 'new row for relation "messages" violates check constraint "messages_check"'),
      postgrest("42501", 'new row violates row-level security policy for table "messages"'),
      postgrest("23503", 'insert or update on table "likes" violates foreign key constraint "likes_post_id_fkey"'),
      postgrest("PGRST116", "JSON object requested, multiple (or no) rows returned"),
      postgrest("PGRST303", "JWT expired"),
      postgrest("22P02", 'invalid input syntax for type uuid: "x"'),
    ]) {
      expect(errorMessage(refused, FALLBACK)).toBe(FALLBACK);
    }
  });

  it("shows the words our own SQL raised for the member", () => {
    const onlyAdmin = postgrest(
      "P0001",
      "You are the only admin. Make another member an admin before deleting this account.",
    );
    expect(errorMessage(onlyAdmin, FALLBACK)).toBe(onlyAdmin.message);
    expect(errorMessage(postgrest("P0001", "You cannot block yourself"), FALLBACK)).toBe("You cannot block yourself");
  });

  it("shows the words our own code threw", () => {
    expect(errorMessage(new Error("Only the author can delete a post."), FALLBACK)).toBe("Only the author can delete a post.");
    expect(errorMessage("Only the author can change a caption.", FALLBACK)).toBe("Only the author can change a caption.");
  });

  it("says the fallback for a dropped connection, a timeout or a request called off", () => {
    expect(errorMessage({ message: "TypeError: Network request failed", details: "", hint: "", code: "" }, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(new TypeError("Network request failed"), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(new TimeoutError("Deleting the post"), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(abortError(), FALLBACK)).toBe(FALLBACK);
  });

  it("says the fallback for a server's Error, a native one, or a mistake in the code", () => {
    const storage = Object.assign(new Error("new row violates row-level security policy"), { statusCode: "403" });
    const auth = Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), { status: 400, code: "refresh_token_not_found" });
    const keychain = Object.assign(new Error("User interaction is not allowed."), { code: "ERR_KEY_CHAIN" });
    const bug = new TypeError("undefined is not an object (evaluating 'post.author.username')");
    for (const err of [storage, auth, keychain, bug, new ReferenceError("x is not defined")]) {
      expect(errorMessage(err, FALLBACK)).toBe(FALLBACK);
    }
  });

  it("says the fallback for nothing at all", () => {
    for (const err of [undefined, null, 0, "", "   ", new Error(""), { message: "" }]) {
      expect(errorMessage(err, FALLBACK)).toBe(FALLBACK);
    }
  });

  it("can say nothing, for an alert that has its own words to fall back on", () => {
    expect(errorMessage(postgrest("42501", "permission denied for table messages"), "")).toBe("");
  });
});

/**
 * Supabase Auth's refusals, as auth-js throws them (its own classes, not
 * look-alikes): the words written for the person at the door come
 * through, its outages and session states do not.
 */
describe("what someone signing in or up is shown", () => {
  const DOOR = "Check your connection and try again.";

  it("a wrong password, an email already taken and a weak password, in Supabase Auth's words", () => {
    const wrong = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
    expect(errorMessage(wrong, DOOR)).toBe("Invalid login credentials");
    const taken = new AuthApiError("User already registered", 422, "user_already_exists");
    expect(errorMessage(taken, DOOR)).toBe("User already registered");
    const weak = new AuthWeakPasswordError("Password should be at least 6 characters.", 422, ["length"]);
    expect(errorMessage(weak, DOOR)).toBe("Password should be at least 6 characters.");
    // As a server's legacy answer without a code.
    expect(errorMessage(new AuthApiError("Email not confirmed", 400, undefined), DOOR)).toBe("Email not confirmed");
  });

  it("the fallback for an outage, too many tries, a timeout or the session's own state", () => {
    for (const err of [
      new AuthRetryableFetchError("Failed to fetch", 0),
      new AuthRetryableFetchError("Service Unavailable", 503),
      new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
      new AuthApiError("email rate limit exceeded", 429, "over_email_send_rate_limit"),
      new AuthApiError("Request timeout", 408, "request_timeout"),
      new AuthApiError("Internal error", 500, "unexpected_failure"),
      new AuthSessionMissingError(),
      new AuthUnknownError("Unexpected token < in JSON", new SyntaxError("x")),
      new AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used"),
      new AuthApiError("Session from session_id claim in JWT does not exist", 403, "session_not_found"),
      new AuthApiError("Could not parse request body as JSON", 400, "bad_json"),
    ]) {
      expect(errorMessage(err, DOOR), `${err.name} ${err.message}`).toBe(DOOR);
    }
  });

  it("a refusal's words only from auth-js itself, never from any Error that has a status", () => {
    // Shaped like a refusal but not one of Auth's: still the server's, still the fallback.
    const lookalike = Object.assign(new Error("Invalid login credentials"), { status: 400, name: "AuthApiError" });
    expect(errorMessage(lookalike, DOOR)).toBe(DOOR);
    // Auth's words that give away the machinery are still caught by what they say.
    expect(errorMessage(new AuthApiError("invalid JWT: unable to parse or verify signature", 400, "validation_failed"), DOOR)).toBe(DOOR);
  });
});

/** Each door's own alert, read from its source and run on what auth-js throws. */
describe("the door's alerts", () => {
  const alertOf = (file: string, title: string) => {
    const src = code(file);
    const m = src.match(new RegExp(`showAlert\\("${title}", errorMessage\\(err, "([^"]+)"\\)\\);`));
    expect(m, `${file}: "${title}" through errorMessage`).toBeTruthy();
    return m![1];
  };

  it("Sign in says a wrong password in Supabase Auth's words, and an outage in its own", () => {
    const fallback = alertOf("app/(gate)/sign-in.tsx", "Sign in failed");
    expect(errorMessage(new AuthApiError("Invalid login credentials", 400, "invalid_credentials"), fallback)).toBe("Invalid login credentials");
    expect(errorMessage(new AuthRetryableFetchError("Network request failed", 0), fallback)).toBe(fallback);
    expect(fallback).toBe("Check your connection and try again.");
  });

  it("Apply and the invitation say a refusal written for them, and never the database's words", () => {
    const apply = alertOf("app/(gate)/apply.tsx", "Application failed");
    const invite = alertOf("app/(gate)/invite.tsx", "Couldn’t join");
    for (const fallback of [apply, invite]) {
      expect(errorMessage(new AuthWeakPasswordError("Password is known to be weak and easy to guess, please choose a different one.", 422, ["pwned"]), fallback)).toBe(
        "Password is known to be weak and easy to guess, please choose a different one.",
      );
      // A refused insert into applications, as postgrest-js hands it back.
      expect(errorMessage(postgrest("42501", 'new row violates row-level security policy for table "applications"'), fallback)).toBe(fallback);
      expect(errorMessage({ code: "", message: "", details: null, hint: null }, fallback)).toBe(fallback);
    }
    // src/api/membership.ts's own sentences come through as they are.
    expect(errorMessage(new Error(ACCOUNT_EXISTS), apply)).toBe(ACCOUNT_EXISTS);
    const refused = "Every invitation they were given has been taken up. Your account has been created; enter a valid invitation to join.";
    expect(errorMessage(new Error(refused), invite)).toBe(refused);
  });
});

describe("the text an error carries", () => {
  it("reads .message from a plain object and from an Error, and a string as it is", () => {
    expect(messageOf({ code: "23514", message: " the words " })).toBe("the words");
    expect(messageOf(new Error("the words"))).toBe("the words");
    expect(messageOf("the words")).toBe("the words");
  });

  it("never turns an object into text", () => {
    expect(messageOf({ code: "23514" })).toBe("");
    expect(messageOf(42)).toBe("");
    expect(messageOf(null)).toBe("");
  });
});
