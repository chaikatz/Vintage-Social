import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { code, root } from "./helpers/screenSource";

/**
 * An address the app does not know goes home.
 *
 * With no not-found route of its own, expo-router answers one with its
 * developer page, "Unmatched Route", and a Sitemap link listing every
 * route in the app, the admin pages among them (Guideline 2.1). The web
 * demo walk opens /no-such-page and expects the door (e2e/launch-test.mjs).
 */

describe("an unknown address", () => {
  it("is answered by the app's own not-found screen, at the root of the routes", () => {
    expect(existsSync(path.join(root, "app/+not-found.tsx"))).toBe(true);
  });

  it("which goes home and shows nothing of its own", () => {
    const src = code("app/+not-found.tsx");
    expect(src).toMatch(/export default function NotFound\(\)/);
    expect(src).toContain('slug ? <Redirect href={{ pathname: "/(gate)/invite", params: { slug } }} /> : <Redirect href="/" />');
    // No header titled "+not-found" for the moment before it goes.
    expect(src).toContain("<Stack.Screen options={{ headerShown: false }} />");
    // Nothing to read, nothing to tap: no text, no link, never the sitemap.
    expect(src).not.toMatch(/<Text\b|<Link\b|_sitemap|Sitemap/);
  });

  it("is the only not-found screen, so no group answers with a page of its own", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/^\+not-found\.tsx?$/.test(name)) found.push(path.relative(root, full));
      }
    };
    walk(path.join(root, "app"));
    expect(found).toEqual(["app/+not-found.tsx"]);
  });
});

/**
 * One unknown address is an invitation: /i/<code> is the web address a
 * member shares (inviteUrl). Should it open the app (universal links are
 * not in 1.0), it goes to the invitation with its code rather than home
 * with the code lost. The screen's own reader, run as written.
 */
describe("an invitation's web address", () => {
  const src = code("app/+not-found.tsx");
  const fn = src.slice(src.indexOf("function invitationIn("));
  const js = ts.transpileModule(fn.slice(0, fn.indexOf("\n}\n") + 2), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const invitationIn = new Function(`${js}; return invitationIn;`)() as (p: string | undefined) => string | null;

  it("carries its code to the invitation", () => {
    expect(invitationIn("/i/applereview")).toBe("applereview");
    expect(invitationIn("/i/Chai-Katz-Photographs/")).toBe("chai-katz-photographs");
    expect(invitationIn("/i/someone-invitation")).toBe("someone-invitation");
  });

  it("and nothing else is taken for one", () => {
    for (const p of ["/no-such-page", "/i", "/i/", "/i/a/b", "/x/i/abc", "/i/abc?x=1", "/invite", "", undefined]) {
      expect(invitationIn(p), String(p)).toBeNull();
    }
  });
});
