import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
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
    expect(src).toContain('<Redirect href="/" />');
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
