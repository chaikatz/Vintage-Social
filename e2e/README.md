# Launch test

One script that walks the whole founding-member journey through the real
UI: application → approval → membership number → sign-in → follow →
chronological feed → post → filter → like → comment → profile →
nomination → redemption → moderation.

```bash
npm i -D playwright && npx playwright install chromium   # once
npm run build:web                                        # export the web build
npm run test:e2e                                         # serve it and drive it
```

Playwright is not a dependency of the project on purpose: it pulls a
browser download that every install would pay for, to run a harness only a
maintainer runs.

It runs against the demo backend, which lives in the page. That shapes the
script in one important way: everything that depends on state piling up —
an application being submitted and then found in the admin queue, a
nomination being minted and then redeemed — is navigated by *tapping*,
because a page load would wipe the store. Checks that stand alone use a
direct URL, which is steadier than fighting a navigation stack that keeps
every screen mounted.

Two consequences of react-native-web worth knowing before adding checks:

- Screens are never unmounted, so asserting that some text is *absent*
  proves nothing — the landing is still in the DOM behind the feed. Assert
  positively.
- The tab bar is a pager with all five pages mounted, the inactive ones
  parked off-screen, so a tab tap is confirmed via `aria-selected` before
  anything on that page is trusted.
