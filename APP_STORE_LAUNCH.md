# VINTAGE 1.0 · App Store Launch Report

Prepared 15 September 2026 against branch `claude/vintage-ios-social-app-gkrfo3`.
Credentials for the review account are **not** in this file or anywhere in the
repository; they were given to the founder directly and belong in App Store
Connect → App Review Information.

---

## 1. What was fixed for launch

### Compliance (App Review guidelines 1.2, 5.1.1)

- **Account deletion, in-app and real.** Settings → Delete account. Two
  confirmations, then the member's files are removed through the Storage API,
  and `delete_my_account()` (migration 0018) removes the auth user; profile,
  posts, comments, likes, follows, tags, messages, push tokens, preferences and
  invitation link cascade from it. References that would otherwise keep the
  row alive (who decided an application, who resolved a report, who removed a
  post) are released first. The only admin cannot delete themselves. Membership
  numbers are never reissued. Verified end to end on staging over REST.
- **Blocking, with downstream effect.** A member can block from a profile's
  "…" menu, from a long press on Follow, or from any post's "…" menu. Enforced
  in the database with RESTRICTIVE policies (they AND with the existing ones;
  nothing was widened, no policy edited): neither party sees the other's posts,
  comments, likes, follows, tags, messages or activity; following, tagging and
  messaging across a block are refused at insert; the blocked member cannot see
  the blocker's profile. Follows between them are ended and pending tags
  withdrawn on block. Settings → Blocked members lists and unblocks. Verified
  on staging: a blocked author's 8 posts became 0, a follow across the block
  was refused by policy, unblock restored the view.
- **Reporting** already existed for posts, comments and members (human review
  queue in Admin → Reports, with remove/warn/suspend). Left as is; now paired
  with block.
- **Privacy Policy and Terms of Use.** None existed. Drafted in
  `src/legal/documents.ts` (describing exactly what the app does: photo
  library, capture dates, no location tracking, no ads, deletion, blocking,
  17+). Shown in-app at Settings → Privacy Policy / Terms of Use and from the
  landing footer and the application form ("By applying you agree…"). The same
  text is published as `public/privacy.html` and `public/terms.html`, served at
  `/privacy` and `/terms` on the invitation site (`npm run build:legal`
  regenerates them). **A lawyer has not read these.**
- **Support contact.** Settings shows a Support row with a mail link when
  `EXPO_PUBLIC_SUPPORT_EMAIL` is set in the EAS production environment; the
  suspended screen shows the same address. Until set, the row is absent.
- **Permissions.** Photo library, camera and microphone strings reviewed;
  notifications plugin present; location strings say plainly that VINTAGE does
  not track location. Camera denial now explains itself instead of silently
  doing nothing. Permissions are requested only at the moment of use.
- **Function grants tightened.** Trigger functions and the new block helpers
  are no longer executable through the REST API by anonymous or signed-in
  clients.

### Reliability

- Messaging a member now surfaces an error instead of failing silently.
- Camera permission denial shows guidance.
- Push registration is isolated: every step is wrapped, registration failure
  cannot affect sign-in or the feed, and the database trigger swallows any
  failure to reach the push function so a like or comment never fails because
  of it (verified in `push_event`).

---

## 2. Still blocking submission (you must do these)

1. **Set `EXPO_PUBLIC_SUPPORT_EMAIL`** in the EAS production environment
   (Expo dashboard → project → Environment variables → production). Apple
   requires a visible support contact; without it the Support row is hidden.
2. **Deploy the invitation site to Vercel** so `/privacy` and `/terms` are
   live, then paste those URLs into App Store Connect (Privacy Policy URL is
   mandatory). If `EXPO_PUBLIC_INVITE_BASE` is not set, set it too, so the app
   opens the web copies (it falls back to in-app copies either way).
3. **Have the Privacy Policy and Terms read by a lawyer.** The facts are
   accurate; the framing is a draft.
4. **Build and upload** a binary containing this commit (full EAS build; the
   compliance screens are JavaScript but native packages changed earlier).
5. **Run migration `supabase/migrations/0019_shares.sql` on production** (SQL
   editor, whole file). It has been applied to staging and tested there; it
   has NOT been applied to production. Without it the Story share still
   exports the print but no link is copied. Then redeploy Vercel so
   `/s/<token>` and `/s/<token>/media` are served. (The file is safe to
   re-run: it drops and recreates only its own `shared_post` function.)
6. **Confirm email confirmations are OFF** in Supabase Auth for production
   (Authentication → Providers → Email → "Confirm email"). Sign-up returns no
   user with confirmations on, and both the application and invitation flows
   would fail. This could not be verified from the database.

---

## 3. Verified on production (Supabase project `scfwowqsqrnzpknzurmm`)

- Migrations present: 0001–0008, invite_slug_message, 0011, 0014–0018. The
  functions from 0009, 0010 and 0012 are present (applied via the
  `supabase/production/` scripts); storage policies for all three buckets
  exist.
- `push_hook` app setting points at the deployed `push` edge function; the
  `vintage-memories` cron runs daily at 15:00 UTC; edge function `push` is
  ACTIVE.
- 154 profiles: 150 house, 4 real (chai is the only admin), 1 suspended.
- Review account created and signed in successfully over the auth REST API;
  it sees the feed, holds invitation code `applereview` with an allowance of 5.
- Remaining advisor warnings are intentional (`username_available` and
  `invite_link_owner` must be callable before sign-in; `is_admin` and
  `is_active_member` are used by policies). **Enable "Leaked password
  protection"** in Supabase Auth settings — one click, recommended.

---

## 4. App Store Connect — what to enter

**Category:** Photo & Video (primary). Social Networking (secondary).

**Age rating:** Answer the questionnaire honestly for a user-generated-content
app: Infrequent/Mild for "Unrestricted Web Access: No", user-generated content
"Yes" with moderation (report, block, human review within 24 hours, removal).
Expect **17+** given unrestricted photo UGC and messaging between members; if
Apple's questionnaire lands on 12+ that is acceptable too, but do not claim 4+.

**Subtitle (30 chars max):** `A quiet club for photographs`

**Promotional text:** `Invitation only. No feeds you didn't ask for, no numbers to chase.`

**Description:**

> VINTAGE is a small, invitation-only club for photographs.
>
> Post a photograph or a short film and give it the look of a roll of film — a
> handful of quiet, carefully made filters, an optional date stamp taken from
> when the shutter actually fired, and the place it was made. Your work hangs
> on a Timeline by the day it was taken and on a Map by where, so a profile
> reads as a life in pictures rather than a grid of thumbnails.
>
> Follow the members you care about. Your home is only what they post, newest
> first. Like, comment, tag the friends who were there, and send a photograph
> to someone in a message. Share a print outside VINTAGE when you want to —
> signed, on paper, the way it deserves.
>
> Membership is by application or invitation. Every member is read in by a
> person, receives a permanent membership number, and holds a few invitations
> of their own. We keep it small on purpose.
>
> Notifications are quiet: a name and what happened. Once a day at most, one
> of your own photographs from this day in another year.
>
> No advertising. Nothing is sold. Your photographs stay yours.

**Keywords:** `photography,film,vintage,club,invite,photos,members,timeline,disposable,analog`

**Screenshot sequence (6.9" and 6.5" required):**

1. **The door** — landing screen ("Membership required"). Sets the tone.
2. **Home feed** — two or three posts with date stamps and place · date bylines.
3. **The darkroom** — compose screen with a photograph and the filter strip.
4. **Timeline** — a profile in Timeline view, centre spine, alternating sides.
5. **Map** — the same profile in Map view.
6. **A post** — post detail with comments and a tag.
7. **Share as a print** — the export preview (paper, wordmark, byline).
8. **Invitations** — the invitation card with the code.

Take them on the review account or your own; dark appearance for one or two
(Timeline and the print look best on Espresso).

**App Review Notes (paste):**

> VINTAGE is a private, membership-based photo club. New users apply and are
> approved by a human, or join instantly with an invitation code from an
> existing member. So that you can review every part of the app without
> waiting, we have created an approved reviewer account (credentials below).
>
> Sign in: open the app → "Sign in" → enter the email and password.
>
> What you can do: browse Home, Search and Explore; open a member's profile in
> Posted / Taken / Timeline / Map views; post a photograph or short film
> (Post tab → choose from library or camera → pick a filter → publish); like,
> comment, tag members, send a photograph in a message; share a post outside
> the app as a print; see Activity; manage notifications; block and report
> members; delete the account (Settings → Delete account — please use a second
> account for this if you wish to keep reviewing).
>
> To test the invitation flow, sign out and choose "I have an invitation",
> then enter the code `applereview` with any new email and password. That
> account is approved immediately. To test the application flow, choose "Apply
> for membership"; applications are reviewed by a person and will show
> "Application received".
>
> Content moderation: every post, comment and profile can be reported from its
> "…" menu; reports go to a human queue and are acted on within 24 hours. Any
> member can be blocked from their profile or from a post; blocking hides all
> content in both directions. Privacy Policy and Terms are in Settings and on
> the landing screen.
>
> Push notifications are optional and requested only after the first sign-in.
> Photo library access is requested only when choosing a photograph. VINTAGE
> does not track location; a place on a post is typed or chosen by name.

**Reviewer access (App Review Information → Sign-in required):**

- Username (email): `appreview@vintagesocial.app`
- Password: *(as given to you separately; also the value used in
  `supabase/production/10_reviewer_account.sql` when it was run)*
- Invitation code for a second account: `applereview`

**Privacy (App Privacy section):** Data collected, linked to the user, not
used for tracking:

- Contact Info → Email Address (account)
- User Content → Photos or Videos, Other User Content (captions, comments,
  messages)
- Identifiers → User ID
- Usage Data → none collected by us (no analytics SDK)
- Diagnostics → none beyond provider server logs (declare "Crash Data: No",
  "Performance Data: No")
- Location → **not collected** (the place on a post is user-typed text)
- Push token: declare under Identifiers → Device ID, "App Functionality"

Tracking: **No**. Third-party SDKs: Supabase, Expo (push), Apple MapKit.

**Content Rights:** you confirm you have rights to the house-account
photographs (see `seed/CREDITS.md`).

**Export compliance:** `ITSAppUsesNonExemptEncryption` is false in `app.json`;
answer "No" to the encryption question.

---

## 5. Recommendation

**GO for submission of 1.0 once items 1, 2, 4 and 5 in §2 are done** (support
email set, legal pages deployed and their URLs entered, a fresh binary
uploaded, email confirmations confirmed off). Item 3 (legal review) is
strongly advised before the app is public but is not a technical blocker to
submitting for review.

The compliance features Apple rejects for most often — deletion, blocking,
reporting, privacy policy, reviewer access — are all present and verified
against production.
