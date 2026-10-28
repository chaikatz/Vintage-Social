import { describe, expect, it } from "vitest";
import { errorMessage, messageOf } from "@/utils/errorMessage";
import { TimeoutError, abortError } from "@/utils/retry";

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
