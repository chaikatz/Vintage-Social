import React from "react";
import { Redirect, Stack } from "expo-router";

/**
 * An address the app does not know: a mistyped or outdated link, a route
 * that has since gone. It goes home, where the root sends each person on
 * to the door, the waiting screen or the app, as at launch.
 *
 * Without this screen expo-router showed its developer page, "Unmatched
 * Route", with a Sitemap link that lists every route in the app, the admin
 * pages among them (App Review Guideline 2.1).
 */
export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Redirect href="/" />
    </>
  );
}
