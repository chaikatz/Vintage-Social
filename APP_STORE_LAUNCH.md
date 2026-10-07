# VINTAGE 1.0 · App Store Release Candidate

Prepared 7 October 2026 against branch `claude/vintage-ios-social-app-gkrfo3`.
This replaces the 15 September launch report. Everything below was checked
against the repository and the live environments on this date; anything that
could not be checked from here is marked **UNVERIFIED** and says what to run.

Credentials for the review account are **not** in this file or anywhere in the
repository. They belong in App Store Connect → App Review Information only.

---

## 1. Release state

| | |
| --- | --- |
| Branch | `claude/vintage-ios-social-app-gkrfo3` |
| Release candidate commit | the commit this file lands in (see `git log -1`) |
| App version | `1.0.0` (`app.json`) |
| iOS build number | managed remotely by EAS (`appVersionSource: remote`, `autoIncrement: true`). **UNVERIFIED** from here — `npx eas-cli build:version:get -p ios` prints the current value; the next build is that plus one. |
| Bundle ID | `com.vintage.social` |
| EAS project | `7d93bd28-2dec-4e7f-8f05-dc2f8c2ecd5f`, owner `chaikatz`, profile `production` (`EXPO_PUBLIC_DEMO_MODE=0`, `environment: production`) |
| Last uploaded build | made 6 October from commit `5fdd20c`. One commit follows it (`afb12d3`: pager one-finger module, gesture fixes, Places cache, waitlist auto-check) plus this release-candidate commit. Both are needed in the final build; `afb12d3` adds a native module, so a full EAS build is required, not an update. |
| Production Supabase | `scfwowqsqrnzpknzurmm` ("Vintage-Production 09/01/26") |
| Staging Supabase | `omvezsrkjizxdfeogccw` — holds no real member data, never referenced by a production build |
| Web | https://vintagesocial.app on Vercel, HTTPS enforced (HTTP → 308 to HTTPS, HSTS two years) |

### Migrations

All twenty files in `supabase/migrations/` are applied to **both** projects.
Production's own migration ledger (`supabase_migrations.schema_migrations`)
lists only 0001–0008, 0011, 0013–0018, because 0009, 0010, 0012, 0019 and
0020 were run through the SQL editor, which does not record them. Their
objects were verified present on production on 7 October:

| Migration | Production evidence |
| --- | --- |
| 0009 storage read-own | `media: read own folder` storage policy present |
| 0010 invitation wording | `invite_slug_status`, `reserved_invite_slugs` present |
| 0012 invite links | `invite_links` table, `ensure_invite_link`, `set_invite_slug`, `rotate_invite_link`, `invite_link_owner`, `redeem_invite_link` present |
| 0019 shares | `post_shares`, `share_events` (RLS on), `create_post_share`, `revoke_post_share`, `live_share_post`, `shared_post`, `shared_post_media(text,text)`, `record_share_event` present, grants as the file states; `app_settings.share_media_key` row present (set 16 September) |
| 0020 photos baked | every photo row carries `filter_baked = true` (1027 rows on 6 October) |

**No migration needs to be applied for 1.0.** Nothing destructive is pending.

### Backend

- Edge function `push` is ACTIVE on production (version 1); `app_settings.push_hook` points at it; five push tokens are registered; cron `vintage-memories` runs daily at 15:00 UTC.
- RLS is enabled on all 20 public tables.
- Email confirmation is **off** for production: on 6 October a fresh applicant signed up and, with the session the sign-up returned, immediately created their application row. With confirmations on, sign-up returns no session and that write could not have happened.
- Supabase security advisor: the only warnings are the `SECURITY DEFINER` functions that are callable by design (`username_available` and `invite_link_owner` must answer before sign-in; the share functions answer the web server; the rest are the app's RPC surface and check `auth.uid()` themselves) and **leaked-password protection being off** — see §3.

### Web (vintagesocial.app), checked 7 October

| Route | Result |
| --- | --- |
| `/` | 200, landing page, renders at iPhone width with no horizontal overflow |
| `/privacy`, `/terms` | 200, the documents, "Last updated September 15, 2026" |
| `/apply`, `/invite`, `/sign-in`, `/landing` | 200, the app's own screens |
| `/i/early`, `/i/applereview` | 200, invitation page; `/i/<unknown>` → 404 "no longer open" |
| `/s/<live token>` | 200, page with the photograph's words; HTML contains no storage address |
| `/s/<live token>/media` | **404 — the picture does not load.** See §3, item 1. |
| `/s/<token>/request` | 302 → `/apply` |
| `/s/<unknown 32-hex>`, `/s/<malformed>` | 404 |
| `/.well-known/apple-app-site-association` | 404 by design (`APPLE_TEAM_ID` not set); the app declares no associated domains, so universal links are not part of 1.0 and nothing depends on this |
| `/invite-card.png`, `/3d/*` | 200 |

---

## 2. What was audited

### Automated (run 7 October on this commit)

| Check | Result |
| --- | --- |
| TypeScript (`npm run typecheck`) | clean |
| Unit tests (`npm test`) | 39 files, 264 tests, all passing |
| `npx expo-doctor` | 18/18 checks passed |
| Web export (`expo export --platform web`) | builds |
| Policy tests (`npm run test:rls`) | migrations 0001–0016 apply cleanly to a throwaway PostgreSQL 16; the run stops at 0017 because that file needs the `pg_net` extension, which the local server does not have. 0017–0020 and the share-policy file were therefore **not** exercised here; the share functions were instead checked directly on production (below). |
| Launch test (`npm run test:e2e`, Playwright against the demo build) | **32/32 checks passed**: application → waitlist → approval → invitation → feed → like → comment → follow → private gate → explore → messages → compose with filter, place and date stamp → publish. The script's expected wording was brought up to the current product (invitations, "Members only", MEMBER, the place sheet); no product code was changed for it. The only console errors are two "no supported source" messages from the demo's seeded sample videos, which headless Chromium cannot decode. |

### Sharing (migration 0019), checked on production as the `anon` role

- `shared_post_media(<live token>, 'wrong key')` → 0 rows; with an empty key → 0 rows.
- `shared_post(<live token>)` → 1 row of words only (kind, shape, place, date, username); `shared_post(<unknown token>)` → 0 rows.
- `live_share_post(...)` → permission denied (not callable by anon or authenticated).
- Direct `select` on `post_shares` and `app_settings` → 0 rows. Direct `select` on `posts` and `profiles` → refused outright (the blocking policy calls a function anon may not execute, so anon reads error rather than return rows; nothing in the app reads those tables before sign-in).
- The public page's HTML points only at `/s/<token>/media`; the storage address is resolved server-side and never sent. The media route copies an allow-list of headers, never redirects, and marks itself `no-store`.
- `SHARE_MEDIA_KEY` is server-only on Vercel (no `EXPO_PUBLIC_` prefix); only its SHA-256 is in the database; the key is in no bundle and no file in the repository. The one `service_role` reference in the codebase is the `push` edge function reading its own runtime secret.
- The migration file is idempotent (`if not exists` / `create or replace` / `drop if exists`) and says so accurately. Its header line "NOT YET APPLIED TO PRODUCTION" is stale: it has been applied. Left as written so the file's hash does not change.

**Verdict: the design is secure as implemented. It is not working in production because the key on Vercel does not match the hash in the database** (item 1 below). No redesign.

### Compliance surfaces (code read, and where noted, exercised)

- **Account deletion** — Settings → Delete account → two confirmations → files removed from all three buckets, then `delete_my_account()` removes the auth user and everything cascades. Reachable without contacting anyone.
- **Blocking** — profile "…" menu, long-press on Follow, or any post's "…" menu; Settings → Blocked members to unblock. Enforced by RESTRICTIVE database policies in both directions. Functions present on production with grants to `authenticated` only. No block has yet been made on production, so this is verified on staging (15 September) and by code, not by production data.
- **Reporting** — every post, comment and member has Report in its "…" menu; two reports exist on production; Admin → Reports resolves them with remove / warn / suspend.
- **Suspended member** — the tab layout sends anyone not approved to the waitlist screen, which for `suspended` shows "Account suspended", the support address and Sign out.
- **Waitlist** — "Application received", "I have an invitation" (code or link), "Check status", "Sign out". Since `afb12d3` the screen also re-reads membership whenever the app returns to the front and every 30 seconds, and walks an approved applicant in.
- **Privacy / Terms** — in Settings and on the landing screen; open the web copies when the URLs are configured, the bundled copies otherwise, so no build ships a dead link.
- **Permissions** — photo library, camera, microphone, media-library (capture date), location (never requested; the strings say so), notifications (asked after first sign-in; a refusal returns null and nothing else changes). The app never writes to the photo library, so the "does not save anything" string is true. Camera refusal shows an explanation.
- **Error states** — `LoadFailed` with retry on every list; "This photograph is gone" for a removed post; `EmptyState` on empty lists; image placeholders; a video that stalls shows a play mark after 2.5 s; invalid invitation and invalid share token both answer 404 pages; a server failure answers 503 so a crawler does not cache a wrong "gone".

---

## 3. What remains — in order

1. **Fix the share-media key (production bug, external sharing is in 1.0).**
   The share page renders but the photograph answers 404 because the key the
   Vercel function sends does not match the hash stored on 16 September. One
   key, set in two places, then redeploy:

   ```bash
   openssl rand -hex 32          # on your Mac; copy the output
   ```

   - Vercel → project → Settings → Environment Variables → `SHARE_MEDIA_KEY`
     → replace the value with that key, for **Production** (and Preview). No
     quotes, no trailing newline.
   - Supabase → Vintage-Production (`scfwowqsqrnzpknzurmm`) → SQL editor →
     open `supabase/production/11_share_media_key.sql`, put the same key in
     place of `PASTE_KEY_HERE`, run it. It stores only the hash and prints one
     row with `hash_length 64`. Do not save the file with the key in it.
   - `cd ~/Documents/Vintage-Social && npx vercel --prod`
   - Check: open any share link from the app (Post → … → Share outside →
     link) in Safari; the photograph should show. From a terminal,
     `curl -sI https://vintagesocial.app/s/<token>/media | head -1` should
     read `HTTP/2 200`.

2. **Confirm the EAS production environment** (`npx eas-cli env:list production`).
   It must contain `EXPO_PUBLIC_SUPABASE_URL` (the production URL),
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_INVITE_BASE`
   (`https://vintagesocial.app`) and `EXPO_PUBLIC_SUPPORT_EMAIL`. **UNVERIFIED**
   from here. The first three are evidently set, since the TestFlight build
   talks to production and members' share links are web links; the support
   address could not be inferred. Without it the Support row in Settings is
   hidden and the Privacy Policy's "support address shown in Settings" points
   at nothing — Apple does ask for a visible support contact.

3. **Sign in once as the review account on TestFlight** (`appreview@vintagesocial.app`,
   password as you hold it). The account is approved, email-confirmed, not
   banned, follows 12 members and has 96 posts in its Home feed; but its last
   sign-in was 15 September and the password cannot be checked from here.
   **UNVERIFIED** until you do this. To rotate it, run the `UPDATE` at the
   bottom of `supabase/production/10_reviewer_account.sql` with a new value
   and change it in App Store Connect; never commit it.

4. **Supabase Auth → Attack protection → enable "Leaked password protection".**
   One toggle; recommended by the advisor; not a review blocker.

5. **Legal review** of the Privacy Policy and Terms is still advised. The
   facts in them are accurate to the app as built; not a technical blocker.

6. **After Apple approves:** in Vercel set `VINTAGE_INSTALL_URL` to the App
   Store URL and redeploy. Until then the invitation page offers "Open
   VINTAGE" and says the app is in private testing — correct for TestFlight,
   wrong once the app is public.

### Build and submit (only after items 1–3)

```bash
cd ~/Documents/Vintage-Social
git pull origin claude/vintage-ios-social-app-gkrfo3
npm install
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --latest
```

(`--auto-submit` on the build command does the same in one step. The build
number increments itself.)

---

## 4. App Store Connect — what to enter

**App name:** `Vintage Social` is the existing App Store Connect record; keep
it unless `VINTAGE` is available when you check, in which case that is the
better name. The name on the phone's home screen is `Vintage` either way.

**Subtitle (≤ 30):** `Your best photos aren't new.`

**Promotional text (≤ 170, optional):** `Membership by invitation.`

**Description:**

> VINTAGE is a private photo club. Membership is by invitation, or by
> application read by a person.
>
> Post a photograph or a short film with the look of a roll of film — a
> small set of quiet filters, an optional date stamp taken from when the
> shutter actually fired, and the place it was made. Your photographs hang
> on a Timeline by the day they were taken, sit on a Map by where, and are
> filed by the Places they were made, so a profile reads as a life in
> pictures rather than a grid of thumbnails.
>
> Follow the members you care about; your Home is only what they post,
> newest first. Like, comment, tag the friends who were there, and send a
> photograph in a message. When you want to, share a print outside VINTAGE
> with a link that shows that one photograph and nothing else.
>
> Every member receives a permanent membership number and a few invitations
> of their own.
>
> No advertising. Nothing is sold. Your photographs stay yours.

**Keywords (≤ 100 chars):**
`photography,film,vintage,club,invitation,photos,members,timeline,analog,archive`

**Primary category:** Photo & Video. **Secondary:** Social Networking.

**Age rating:** answer the questionnaire honestly for an app with unrestricted
user-generated photographs and member-to-member messaging, with moderation
(report, block, human review). Expect Apple to land on 17+/18+; accept it.
The Privacy Policy already says members must be 17 or over. Do not claim
anything younger.

**Support URL:** `https://vintagesocial.app`
**Privacy Policy URL:** `https://vintagesocial.app/privacy`
**Marketing URL (optional):** `https://vintagesocial.app`
**Copyright:** `© 2026` followed by the legal owner's name as it should appear.

**App Review Information → Sign-in required: yes.**
Username: `appreview@vintagesocial.app`. Password: as you hold it.

**App Review Notes (paste):**

> VINTAGE is a private, invitation-based social network for photographs.
> New members join with an invitation from an existing member or apply and
> are approved by a person. So that you can review everything without
> waiting, the account above is already an approved member: sign in from
> the first screen with "Sign in".
>
> Once in: Home shows photographs from the 12 members this account follows;
> Search finds members; the Post tab publishes a photograph or short film
> from the library or camera (pick a filter, publish); Activity lists likes,
> comments and follows; Profile shows your own photographs as a grid, a
> Timeline, a Map and by Places. On any photograph you can like, comment,
> tag members, send it in a message, and share it outside the app as a print
> with a web link.
>
> Account deletion: Profile → Settings (gear, top right) → Delete account.
> Two confirmations, then the account and all its content are removed. If you
> wish to keep reviewing, please use a second account for this — see below.
>
> Reporting and blocking: every post, comment and profile has a "…" menu
> with Report; a member's profile "…" menu has Block member (also by long-
> pressing Follow). Blocking hides all content in both directions. Settings →
> Blocked members lists and unblocks. Reports go to a human queue and are
> acted on within 24 hours.
>
> To test joining: sign out (Settings → Sign out), choose "I have an
> invitation", enter the code `applereview` with any new email and password.
> That account is approved immediately. To see the application path, choose
> "Apply for membership"; applications are read by a person and the screen
> says "Application received" with a Check status button.
>
> Notifications are optional and asked for after the first sign-in. Photo
> library access is asked for only when choosing a photograph. VINTAGE never
> asks for or uses the device's location; a place on a post is typed or
> chosen by name. There are no purchases, subscriptions or advertisements.
> The app is iPhone-only, portrait, iOS 15.1 and later.

**App Privacy questionnaire.** Data collected, linked to the user, not used
for tracking, no third-party advertising:

| Category | Answer |
| --- | --- |
| Contact Info → Email Address | collected, app functionality (account) |
| User Content → Photos or Videos | collected, app functionality |
| User Content → Other User Content | collected (captions, comments, messages, application answers) |
| Identifiers → User ID | collected, app functionality |
| Identifiers → Device ID | collected (push token), app functionality |
| Location | **not collected** — never requested |
| Usage Data, Diagnostics | not collected (no analytics or crash SDK) |
| Tracking | **No** |

Third-party services: Supabase (database, storage, auth), Expo (push
delivery), Apple MapKit (maps and place search), Vercel (web pages).

**Export compliance:** `ITSAppUsesNonExemptEncryption` is `false`; answer
"No".

**Content rights:** you hold the rights to the house-account photographs
(`seed/CREDITS.md`).

---

## 5. Screenshots (6.9" and 6.5" iPhone, portrait)

Take them on your own account (it has 102 photographs) in light appearance
unless noted. Eight frames, short headline above each, nothing else drawn on
them. Capture the real screen; do not stage any UI.

| # | Screen | Headline |
| --- | --- | --- |
| 1 | Home feed, two posts visible with date stamps and place · date bylines | `Your best photos aren't new.` |
| 2 | Your profile, Timeline view, zoomed to actual size, three or four entries | `A life in pictures.` |
| 3 | Your profile, Map view | `Everywhere you've been.` |
| 4 | Your profile, Posted grid, header with MEMBER · NO. 00001 | `Your archive.` |
| 5 | A post opened, with two or three comments and a tag | `Friends, quietly.` |
| 6 | Compose, a photograph in the darkroom with the filter tray | `Give it the look of film.` |
| 7 | Share outside → the print preview (paper, wordmark, byline) — Espresso appearance | `Share a print.` |
| 8 | Invitations screen with your link and allowance | `Membership by invitation.` |

If you want six, drop 4 and 6.

---

## 6. Manual iPhone QA (30–45 minutes, on the final TestFlight build)

Have two devices or a second Apple ID ready for the invitation and message
steps; otherwise use your own account where it says "second account".

**Fresh install (3 min)**
1. Delete the app, install from TestFlight, open. Landing shows the V, three ways in, Privacy · Terms. No black flash.
2. Tap Privacy, then Terms: both open and come back.

**Application (3 min)**
3. Apply for membership with a throwaway email. Lands on APPLICATION RECEIVED. Tap Check status: "Still waiting · checked <time>". Sign out returns to the landing.
4. On your own phone: Profile → shield → Applications → Approve it. Back on the applicant: within 30 s (or on Check status) it enters the app.

**Invitation (3 min)**
5. Sign out. I have an invitation → code `applereview` (or your own) → new email → Accept. Straight into Home. Profile shows MEMBER · NO. with the next number.

**Sign in (1 min)**
6. Sign out. Sign in with your own account. From every tab, a swipe from the left edge does **not** leave the app; swiping between tabs works.

**Feed and follow (3 min)**
7. Home scrolls; pull to refresh. Open a member from a post → Follow → Following. Unfollow.
8. Pinch a photograph in the feed: it grows under your fingers and springs back; the tabs do not move.

**Post a photograph (5 min)**
9. Post tab → library → pick a portrait-shaped photo → it stays its shape in the darkroom → choose None, then a filter → Date stamp on → place: type three letters, pick a result → tag a member → Share to VINTAGE. It appears at the top of Home within a few seconds, square in the feed, full shape when opened.
10. Post a short video the same way. It plays when opened.

**Like, comment, message, notification (5 min)**
11. From the second account: like and comment on your new post. Your Activity shows both; a push arrives if you allowed notifications.
12. On your post: tap the like count → the list of who liked it (own posts only).
13. Send the post to the second account in a message. Open the thread from Home → paper plane; reply.

**Profile views (5 min)**
14. Profile → Posted, Taken, Timeline, Map, Places. Places opens already placed (no "Placing…" wait on second open).
15. Timeline: pinch to zoom; the header stays still; one finger drags the magnified line; Actual size resets. Open another member's profile and repeat; a swipe from the left edge still goes back when at actual size.
16. Change your profile photo in Settings; it updates everywhere at once.

**Search (1 min)**
17. Search a name: people you follow come first; a stranger appears below.

**Share outside (3 min)**
18. Post → … → Share outside → Story and Print both render with the wordmark, MEMBER · NO. and "Members only". Copy the link; open it in Safari: the page **and the photograph** show (after §3 item 1). Turn the link off in the app; reload: "no longer open".

**Block and report (3 min)**
19. From the second account's profile: … → Block member. Their posts vanish from Home and Search; their profile no longer shows yours. Settings → Blocked members → Unblock; posts return.
20. On any post: … → Report → a reason → sent. Your admin Reports queue shows it.

**Delete account (2 min)**
21. On the throwaway account from step 3 or 5: Settings → Delete account → two confirmations → lands on the landing. Sign-in with that email now fails.

---

## 7. Known and accepted for 1.0 (not blockers)

- The review account has no membership number (it was created by script, not
  approved through the sequence), so its profile shows no MEMBER line. Left
  as is: assigning one would spend a number in the permanent sequence.
- Universal links are not configured (no associated domains in `app.json`,
  no Team ID on Vercel). Invitation links open the web page, which deep-links
  into the app with `vintage://` when installed.
- `.env.staging` is committed with the **staging** project's publishable
  (anon) key, by design and documented in the file. No production value is
  in the repository.
- Production's migration ledger does not list the hand-applied files (0009,
  0010, 0012, 0019, 0020). Harmless; verified by object instead.
- Media and thumbnail buckets are public-by-URL (unguessable UUID paths), as
  the app has always worked; the share server adds no new exposure.
- Anonymous direct reads of `posts` / `profiles` error instead of returning
  nothing; nothing anonymous reads them, and no row is exposed.
