import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DELETION_KEEPS_REPORTS, PRIVACY_POLICY, TERMS_OF_USE } from "@/legal/documents";
import { isSupportEmail, renderLegalPages, renderSupportPage, supportAddressIn } from "../scripts/build-legal.mjs";

/**
 * The documents App Review reads, and the pages it opens.
 *
 * The web copies at /privacy and /terms are built from the app's own
 * text by scripts/build-legal.mjs; a copy left behind is the policy a
 * reviewer reads saying something the app no longer says. The support
 * page is the Support URL: Apple asks it for a way to reach a person.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("the Terms a member agrees to", () => {
  it("say there is no tolerance for objectionable content or abuse (Guideline 1.2)", () => {
    const terms = TERMS_OF_USE.toLowerCase();
    expect(terms).toContain("no tolerance for objectionable content");
    expect(terms).toContain("abuse of other members");
    expect(terms).toContain("you agree to them when you apply for membership or accept an invitation");
    for (const phrase of ["report", "block", "within 24 hours", "remove content", "suspend"]) expect(terms).toContain(phrase);
  });
});

describe("the web copies of the documents", () => {
  it("are the app's own words, as the script renders them today", () => {
    const pages = renderLegalPages(read("src/legal/documents.ts"));
    expect(read("public/privacy.html"), "run npm run build:legal").toBe(pages.privacy);
    expect(read("public/terms.html"), "run npm run build:legal").toBe(pages.terms);
  });

  it("say what the app shares and saves, in the same words as the permission strings and the privacy label", () => {
    const policy = PRIVACY_POLICY;
    expect(policy).toContain("We add nothing to it unless you choose Save Image or Save Video in the share sheet.");
    expect(policy).toContain("Apple’s map service");
    expect(policy).toContain("Sharing outside VINTAGE.");
    expect(policy).toContain("make and model");
    expect(policy).toContain("where your photographs live online");
  });
});

describe("the support page", () => {
  it("is written only with a real address, and carries it as a mailto link", () => {
    expect(isSupportEmail("help@vintagesocial.app")).toBe(true);
    for (const bad of ["", "help", "help@", "@vintagesocial.app", "help@vintagesocial", "a b@c.d", 'x"@y.z', null, undefined]) {
      expect(isSupportEmail(bad), String(bad)).toBe(false);
    }
    expect(() => renderSupportPage("PASTE_ADDRESS_HERE")).toThrow();
    const html: string = renderSupportPage("help@vintagesocial.app");
    expect(html).toContain('href="mailto:help@vintagesocial.app?subject=VINTAGE%20support"');
    expect(supportAddressIn(html)).toBe("help@vintagesocial.app");
  });

  it("tells a member how to reach a person, report, block and delete their account, as the app does it", () => {
    const html: string = renderSupportPage("help@vintagesocial.app");
    expect(html).toContain("A person reads every message.");
    expect(html).toContain("Settings → Delete account");
    expect(html).toContain("Block member");
    expect(html).toContain("press and hold it");
    expect(html).toContain('<a href="/privacy">Privacy Policy</a>');
    expect(html).toContain('<a href="/terms">Terms of Use</a>');
    // What the page says is where the app puts it.
    expect(read("app/settings.tsx")).toContain("Delete account");
    expect(read("app/settings.tsx")).toContain(">Support<");
    expect(read("app/user/[username].tsx")).toContain('"Block member"');
    // A comment is reported from the menu a long press on it opens, wherever
    // it is shown (tests/comment-menu.test.ts has the previews under a photograph).
    expect(read("app/comments.tsx")).toMatch(/<Pressable[^>]*\bonLongPress=\{/);
    expect(read("app/comments.tsx")).toMatch(/showCommentMenu\(comment, \{ userId, isAdmin \}, /);
    expect(read("src/utils/commentMenu.ts")).toContain('"Report comment"');
  });

  it("when committed, is the current rendering of its own address", () => {
    const file = path.join(root, "public/support.html");
    if (!existsSync(file)) return;
    const html = readFileSync(file, "utf8");
    const address = supportAddressIn(html);
    expect(address, "public/support.html carries no usable address").toBeTruthy();
    expect(html, "run npm run build:legal").toBe(renderSupportPage(address));
  });
});

/**
 * What the policy says happens to a member's things when they leave, read
 * against what the database actually does with each table's rows.
 *
 * The migrations are read in number order and the last word on a foreign
 * key wins, so a later migration that changes what a deletion does (say,
 * keeping reports with no reporter) fails here until the policy and the
 * support page say the same.
 */
const stripSql = (sql: string) => sql.replace(/--[^\n]*/g, "");
const migrations = () =>
  readdirSync(path.join(root, "supabase/migrations"))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((f) => stripSql(read(`supabase/migrations/${f}`)));

/** What deleting the referenced row does to `table.column`: the last definition in the migrations. */
function onDelete(table: string, column: string, references = "public.profiles"): string | null {
  const ref = references.replace(".", "\\.");
  const statement = new RegExp(`^\\s*(?:create table(?: if not exists)?|alter table(?: if exists)?(?: only)?)\\s+public\\.${table}\\b`, "i");
  const action = "(?:\\s+on delete (cascade|set null|restrict|no action))?";
  const inCreate = new RegExp(`\\b${column}\\s+uuid\\b[^,]*?\\breferences\\s+${ref}\\s*\\(id\\)${action}`, "i");
  const inAlter = new RegExp(`foreign key\\s*\\(${column}\\)\\s*references\\s+${ref}\\s*\\(id\\)${action}`, "i");
  let last: string | null = null;
  for (const sql of migrations()) {
    for (const stmt of sql.split(";")) {
      if (!statement.test(stmt)) continue;
      const m = stmt.match(inCreate) ?? stmt.match(inAlter);
      if (m) last = (m[1] ?? "no action").toLowerCase();
    }
  }
  return last;
}

/** Every source file under a directory (ts, tsx, js, mjs, sql). */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|m?js|sql)$/.test(name)) out.push(readFileSync(full, "utf8"));
    }
  };
  walk(path.join(root, dir));
  return out;
}

const paragraph = (text: string, start: string) => text.split(/\n\n+/).find((p) => p.startsWith(start)) ?? "";
const removedOnDeletion = () => paragraph(PRIVACY_POLICY, "As a member you can").match(/Deleting your account removes ([^.]*)\./)?.[1] ?? "";

describe("what the Privacy Policy says a deletion does, against the schema", () => {
  it("reads the foreign keys it relies on (the reader itself works)", () => {
    expect(onDelete("profiles", "id", "auth.users")).toBe("cascade");
    expect(onDelete("follows", "follower_id")).toBe("cascade");
    expect(onDelete("reports", "profile_id")).toBe("set null");
    expect(onDelete("reports", "resolved_by")).toBe("no action");
    expect(onDelete("reports", "no_such_column")).toBeNull();
  });

  it("an application is kept as the record of the decision and goes with the account, never otherwise", () => {
    expect(onDelete("applications", "user_id")).toBe("cascade");
    // Nothing deletes an application on its own: not the app, not a function, not a migration.
    const deletes = [/delete\s+from\s+(?:public\.)?applications\b/i, /from\(\s*["']applications["']\s*\)[^;]*?\.delete\(/];
    for (const src of [...sources("app"), ...sources("src"), ...sources("supabase/functions"), ...migrations()]) {
      for (const re of deletes) expect(stripSql(src)).not.toMatch(re);
    }
    expect(paragraph(PRIVACY_POLICY, "Your application.")).toContain(
      "Your application is kept with your account as the record of that decision, whatever it was, and is deleted with your account.",
    );
    expect(PRIVACY_POLICY).not.toMatch(/kept while your application is pending/);
    expect(removedOnDeletion()).toContain("application");
  });

  it("the reports a member filed go, or stay, as the reports table says", () => {
    const filed = onDelete("reports", "reporter_id");
    expect(["cascade", "set null"]).toContain(filed);
    const support = renderSupportPage("help@vintagesocial.app");
    if (filed === "cascade") {
      expect(removedOnDeletion()).toContain("the reports you filed");
      expect(support).toContain("and the reports you filed, are removed");
      expect(PRIVACY_POLICY).not.toMatch(/reports you filed are kept/i);
    } else {
      expect(PRIVACY_POLICY).toContain("The reports you filed are kept without your account attached.");
      expect(removedOnDeletion()).not.toContain("reports");
      expect(support).not.toContain("the reports you filed, are removed");
    }
  });

  /**
   * What the two screens that delete an account say before they ask, held
   * to the same schema: "anything you posted or sent is removed" stopped
   * being so when 0031 kept the reports a member filed.
   */
  it("the two screens that delete an account say what goes and what stays, as the policy does", () => {
    const firstQuestion = (file: string) => {
      const src = read(file);
      const m = src.match(/showAlert\(\s*"Delete your account\?",\s*(`[^`]*`|"[^"]*")/);
      expect(m, `${file}: the first question`).toBeTruthy();
      return m![1];
    };
    const settings = firstQuestion("app/settings.tsx");
    const pending = firstQuestion("app/(gate)/pending.tsx");
    const kept = onDelete("reports", "reporter_id") === "set null";
    for (const words of [settings, pending]) {
      if (kept) expect(words).toContain("${DELETION_KEEPS_REPORTS}");
      else expect(words).not.toContain("DELETION_KEEPS_REPORTS");
      expect(words).toContain("This cannot be undone.");
    }
    // The one sentence both say is the policy's own.
    expect(PRIVACY_POLICY).toContain(DELETION_KEEPS_REPORTS);
    for (const file of ["app/settings.tsx", "app/(gate)/pending.tsx"]) {
      expect(read(file)).toContain('import { DELETION_KEEPS_REPORTS } from "@/legal/documents";');
    }
    // Settings lists what goes as the policy lists it.
    expect(removedOnDeletion()).toMatch(/^your /);
    expect(settings).toContain(`Your ${removedOnDeletion().replace(/^your /, "")} are removed for good.`);
  });

  it("share links go with the account; the notes about shares stay without it", () => {
    expect(onDelete("post_shares", "owner_id")).toBe("cascade");
    expect(removedOnDeletion()).toContain("share links");
    expect(onDelete("share_events", "actor_id")).toBe("set null");
    expect(paragraph(PRIVACY_POLICY, "As a member you can")).toContain(
      "The notes about your shares outside VINTAGE are kept without your account attached.",
    );
    for (const thing of ["profile", "photographs", "comments", "likes", "follows", "tags", "messages"]) {
      expect(removedOnDeletion()).toContain(thing);
    }
    for (const [table, column] of [
      ["posts", "author_id"],
      ["comments", "author_id"],
      ["likes", "user_id"],
      ["messages", "sender_id"],
    ]) {
      expect(onDelete(table, column), `${table}.${column}`).toBe("cascade");
    }
  });
});

describe("who can see a photograph shared outside VINTAGE", () => {
  it("anyone with the link, a private account's too, until the link is turned off or the photograph deleted", () => {
    const policy = paragraph(PRIVACY_POLICY, "A link you make with Share outside VINTAGE");
    expect(policy).toContain("to anyone who has the link, even if your account is private");
    expect(policy).toContain("until you turn the link off or delete the photograph");
    const shares = stripSql(read("supabase/migrations/0019_shares.sql"));
    const live = shares.slice(shares.indexOf("function public.live_share_post"), shares.indexOf("function public.shared_post("));
    expect(live).toContain("s.revoked_at is null");
    expect(live).toContain("p.removed_at is null");
    // If a private account's links ever stop answering, "even if your account is private" is no longer true.
    expect(live).not.toMatch(/is_private/);
    // Only the author can make a link to a photograph, and can turn it off.
    expect(shares).toContain("p.author_id = v_user");
    expect(read("app/export.tsx")).toContain("revokeShareLink(post.id)");
    // What the page shows: the photograph, its place and date, the username. Nothing else.
    const page = read("api/share.ts");
    for (const field of ["location", "taken_at", "created_at", "username"]) expect(page).toContain(`row.${field}`);
    expect(page).not.toMatch(/row\.(caption|bio|full_name|display_name)/);
  });
});

describe("an account that is not a member's can be deleted", () => {
  it("from the waiting screen, and the documents name the button it has (Guideline 5.1.1(v))", () => {
    // What the documents point at is on the screen, and deletes.
    const pending = read("app/(gate)/pending.tsx");
    expect(pending).toContain('title="Delete my account"');
    expect(pending).toMatch(/await deleteMyAccount\(userId\);/);
    expect(paragraph(PRIVACY_POLICY, "If your application is still waiting")).toContain(
      "Delete my account on that screen, confirmed twice, deletes your account and everything listed above with it.",
    );
    // Writing in stays true as well.
    expect(paragraph(PRIVACY_POLICY, "If your application is still waiting")).toContain(
      "You can also write to the support address from your account’s email and we will delete your account for you.",
    );
    expect(renderSupportPage("help@vintagesocial.app")).toContain(
      "Tap Delete my account there and confirm twice: your account is deleted in the same way.",
    );
    expect(TERMS_OF_USE).toContain(
      "You may delete your account at any time from within the app: a member from Settings, anyone else with Delete my account on the screen the app opens on.",
    );
    // Nobody is told any more that writing in is the only way.
    expect(PRIVACY_POLICY).not.toMatch(/suspended, write to the support address/);
    expect(TERMS_OF_USE).not.toMatch(/anyone else by writing to the support address/);
  });
});

describe("the house accounts", () => {
  it("are said plainly in the Terms to be the club's own, not members", () => {
    expect(read("supabase/migrations/0011_house_accounts.sql")).toMatch(/add column if not exists is_house/);
    const said = paragraph(TERMS_OF_USE, "Some accounts are the club's own house accounts.");
    expect(said).toContain("public-domain and licensed photographs");
    expect(said).toContain("They are not members, and no one answers from them.");
  });
});
