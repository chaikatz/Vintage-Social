import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The SQL that scripts/reviewer-password.mjs prints is pasted into the
 * production SQL Editor, where it runs as one request: one failing statement
 * undoes the password change with it. In Supabase's auth schema
 * refresh_tokens.user_id is character varying while users.id is a uuid, and
 * PostgreSQL has no varchar = uuid operator, so the sessions update must
 * compare text with text. Tried against tables of those types: the uncast
 * form fails with "operator does not exist: character varying = uuid".
 */
const source = readFileSync(join(__dirname, "..", "scripts", "reviewer-password.mjs"), "utf8");

describe("reviewer-password.mjs SQL", () => {
  it("compares refresh_tokens.user_id (text) with users.id as text", () => {
    const update = source.slice(source.indexOf("update auth.refresh_tokens"));
    const where = update.slice(0, update.indexOf(";"));
    expect(where).toMatch(/where user_id = \(select id::text from auth\.users where email = /);
    expect(where).not.toMatch(/select id from auth\.users/);
  });

  it("touches only the reviewer's rows", () => {
    expect(source.match(/where (u\.)?email = '\$\{EMAIL\.replace/g)?.length).toBe(3);
    expect(source).toMatch(/and revoked = false;/);
  });
});
