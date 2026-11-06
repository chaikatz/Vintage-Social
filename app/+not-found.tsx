import React from "react";
import { Redirect, Stack, usePathname } from "expo-router";

/**
 * An address the app does not know: a mistyped or outdated link, a route
 * that has since gone. It goes home, where the root sends each person on
 * to the door, the waiting screen or the app, as at launch.
 *
 * Without this screen expo-router showed its developer page, "Unmatched
 * Route", with a Sitemap link that lists every route in the app, the admin
 * pages among them (App Review Guideline 2.1).
 *
 * One unknown address is known after all: /i/<code>, the web address of
 * an invitation (inviteUrl). Universal links are not in 1.0, but once the
 * domain opens the app, such a link arrives here; it goes to the
 * invitation with its code, as vintage://invite/<code> does, rather than
 * home with the code lost.
 */
export default function NotFound() {
  const pathname = usePathname();
  const slug = invitationIn(pathname);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {slug ? <Redirect href={{ pathname: "/(gate)/invite", params: { slug } }} /> : <Redirect href="/" />}
    </>
  );
}

/** The code in an invitation's web address (/i/<code>), or null. */
function invitationIn(pathname: string | undefined): string | null {
  const m = /^\/i\/([A-Za-z0-9-]+)\/?$/.exec(pathname ?? "");
  return m ? m[1].toLowerCase() : null;
}
