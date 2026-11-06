import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVACY_POLICY, TERMS_OF_USE } from "@/legal/documents";
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
    // A comment is reported from the menu a long press on it opens.
    expect(read("app/comments.tsx")).toMatch(/<Pressable[^>]*\bonLongPress=\{/);
    expect(read("app/comments.tsx")).toContain('"Report comment"');
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
