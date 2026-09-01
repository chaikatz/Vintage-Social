# VINTAGE — Launch readiness

## 1. Verdict

**FAIL** — for deployment reasons, not product ones.

The product passes end to end. The launch test (`e2e/launch-test.mjs`) walks
the whole founding-member journey through the real interface — application →
approval → membership number → sign-in → follow → chronological feed → post →
filter → date stamp → like → comment → profile → nomination → redemption →
moderation — and returns **33/33 checks, zero JavaScript errors**. Unit tests:
67 passing. TypeScript: clean. iOS and web bundles both export.

It fails because **there is no backend**. No Supabase project is connected, so
the app is running its in-memory demo store: nothing is written down, every
device sees its own private copy of a fictional world, and it is all discarded
on reload. Migrations `0001`–`0007` have never been executed against a real
Postgres — they are reviewed and internally consistent, but unrun.

That is a few hours of setup, not a rewrite. Work through §4 and the verdict
becomes PASS. Do not put a real person in front of this until §2 is closed.

---

## 2. Blockers — fix before real users enter

**B1. No Supabase project is connected.** `.env` does not exist, so
`isDemoMode()` is true and every screen is talking to a fake backend. Nothing
persists. This is the whole of the FAIL.

**B2. The migrations have never been run.** `0001`–`0007` need to be applied,
in order, to a live database. Until they execute once, assume syntax and
ordering are unverified — in particular `0007`, which adds the membership
sequence and rewrites `decide_application`, `redeem_invite` and the profile
update policy.

**B3. `supabase/seed.sql` must never touch production.** It inserts thirteen
fictional members, thirty-one photographs and a fake moderation report
directly into `auth.users` and `public.profiles`. If it is run on the real
project, those accounts take founding numbers 1–11 and your first real member
becomes no. 12. Apply migrations only.

**B4. Email confirmation must be off, or sign-up breaks.** `submitApplication`
and `joinWithInvite` both call `supabase.auth.signUp` and then immediately use
the returned user. With confirmations on, Supabase returns no user and the
flow throws "Sign-up did not return a user." Turn confirmations off for the
founding cohort, or the door does not open.

**B5. There is no admin until you make one.** `is_admin()` gates the entire
moderation surface, and nothing in the app can promote anyone. Without the SQL
in §4 step 6 there is no way to approve the first application.

**B6. Storage buckets must exist.** Migration `0004` creates `avatars`,
`media` and `thumbnails` and their policies. If it has not run, every photo
upload fails at publish time.

### Blockers for the App Store specifically

These do not stop a TestFlight or internal-distribution launch to a known
cohort. They will stop review.

**B7. No in-app account deletion.** App Store guideline 5.1.1(v) requires any
app with account creation to offer account deletion in-app. There is none.

**B8. No way to block another member.** Guideline 1.2 requires user-generated
content apps to let a user block abusive users. Reporting exists; blocking
does not.

**B9. No privacy policy URL.** Required at submission, and VINTAGE reads the
photo library and EXIF capture dates, which the policy has to describe.

---

## 3. Non-blocking — can wait

- **Video filters are applied live, not baked.** Burning a filter into footage
  needs a server-side transcode that does not exist yet. The live path was
  rebuilt on `mixBlendMode` because React Native implements only `brightness`
  and `opacity` of the `filter` style on iOS; it is verified in the browser
  but **not yet on a device**. Worth eyes on tomorrow: if video looks flat
  grey rather than filtered, the blend layers are not compositing.
- **Contrast is not reproduced on live video**, and grain is omitted outside
  the GL bake. Photographs get all three, because they are baked.
- **The two seeded video posts point at Google's public sample clips.** Fine
  for a demo, wrong for a real library.
- **No push notifications.** Activity, messages and nomination acceptances are
  only seen when the app is opened.
- **Explore and the message inbox are unpaginated.** Explore caps at sixty
  posts; both are fine at founding-cohort scale and will need paging later.
- **No email is sent anywhere** — not on approval, not on nomination. Approval
  appears in the member's Activity tab, so you will need to tell people to
  look.
- **Membership number shows on the profile only.** Not in the feed byline, not
  in search results. Deliberate; revisit if members want it more visible.
- **`invited_by` is recorded but never displayed.** The data is there for
  later attribution work; nothing surfaces it yet.
- **The waitlist screen does not refresh by itself.** An approved applicant has
  to press "Check status" or reopen the app.
- **Suspension is reversible; there is no hard delete of a member.** Suspending
  blocks all access and keeps the audit trail, which is the right default, but
  there is no way to erase someone on request — related to B7.

### Fixed during this audit

- Signing out from the waitlist screen, or from Settings, left you stranded on
  that screen: the session cleared but the redirect lives in the tab layout
  *underneath* the pushed screen, so the door rendered behind it with no way
  to reach it. Sign-out now unwinds the stack. Confirmed by A/B — without the
  fix, sign-out ends on `/settings`; with it, on the landing.
- A newly admitted member was handed *accepted* follows of the regulars,
  including a private account, bypassing that member's approval. New members
  now follow through the same path everyone else does, so a private account
  still gets a request.
- The admin queue, the members list and the "…" affordances had unlabelled
  icon buttons; the settings and admin controls are now labelled.

---

## 4. Approving the first member and inviting the first cohort

Numbers are issued in the order people are let in, starting at 1, and are
permanent. **Approve yourself first** — that makes you `FOUNDING MEMBER ·
NO. 00001`.

**1. Create the Supabase project.** supabase.com → New project. Keep the
database password.

**2. Turn off email confirmation.** Authentication → Providers → Email →
switch **Confirm email** off. (See B4 — sign-up breaks with it on.)

**3. Apply the migrations, in order.** SQL Editor → paste and run each file
from `supabase/migrations/`, one at a time, oldest first:

```
0001_schema.sql
0002_functions.sql
0003_rls.sql
0004_storage.sql
0005_post_details.sql
0006_messages_and_privacy.sql
0007_member_numbers.sql
```

**Do not run `supabase/seed.sql`.** It is fictional demo data and it would
take your founding numbers (B3).

**4. Point the app at it.** Project Settings → API. Then in the project root:

```bash
cp .env.example .env
```

Fill in both values and restart the dev server (`npm run phone`). The
"Review build · demo data" line disappears from the landing screen when the
app is talking to a real backend — that is your signal it worked.

**5. Create your own account through the app.** Landing → **Apply for
membership**. Use your real email and the username you want permanently.
Submit. You will land on "Application received" — that is expected.

**6. Make yourself admin and member no. 1.** SQL Editor, replacing
`your.username`:

```sql
update public.profiles
set role = 'admin',
    status = 'approved',
    approved_at = now(),
    invite_quota = 50          -- nominations for the founding cohort
where username = 'your.username';

select public.assign_member_no(
  (select id from public.profiles where username = 'your.username')
);
```

The `select` returns your number. It should return `1`. If it returns
anything else, someone or something was approved before you — stop and check
`select username, member_no from public.profiles order by member_no;` before
going further.

**7. Confirm it.** Reopen the app, sign in, go to **Profile**. It should read
**FOUNDING MEMBER · NO. 00001** under your city.

**8. Approve applicants.** Profile → **shield icon** → **Applications**.
Each card shows the name, city, social handle, who nominated them and their
answer to "Why do you want to join VINTAGE?". **Approve** admits them and
issues the next number; **Waitlist** and **Reject** do not. Approving writes a
welcome note into their Activity tab naming their number — there is no email,
so tell them to open the app.

**9. Nominate the rest of the cohort.** Profile → **Nominations**. Tap
**Nominate a member** to mint one code, then **Send** to pass it on. Each code
admits exactly one person, straight in, with no queue and no review — the
person is admitted **on your word**, and the app records permanently that you
put them forward. The count does not refill: you have what step 6 gave you.

Your nominee opens the app → **I have a nomination** → enters the code →
name, username, email, password → **Accept the nomination**. They are in
immediately, numbered on entry, and you get a note that your nomination was
taken up.

**10. Watch the queue.** Reports arrive at Profile → shield → **Reports**.
Members can be warned, suspended and reinstated at shield → **Members**.
Nothing is ever removed, hidden, ranked or banned automatically, and no AI
judgment is involved anywhere in moderation — every action is a person
deciding, recorded in `moderation_actions`.
