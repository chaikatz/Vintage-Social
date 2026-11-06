# VINTAGE 1.0 · App Store launch checklist

Prepared **5 November 2026**. This is the one current checklist. It replaces
the 7 October release-candidate report that used to be in this file, and
`LAUNCH_READINESS.md` (written before the backend existed).

Everything under "Where things stand" was read from the repository, from
production (read-only) and from the public web on 5 November, and
corrected on 6 November after an independent review (the house accounts,
the Privacy Policy's deletion sentences, the migration list). Nothing here
was run on an iPhone or a simulator: none can run where this was prepared.
What only you can do is in section 2, in the order to do it. The two
review blockers found on 5 November (an account that is not a member's
could not be deleted in the app, and the invitation did not say the
Terms are agreed to) are fixed in the sweep's second round, on branch
`r13-door`. **Before you build, check the branch you build has both: see
"Before you build" at the top of section 2.**

Passwords, keys and the review account's password are **not** in this file
or anywhere in the repository, and must never be.

---

## 1. Where things stand

### The app

| | |
| --- | --- |
| What you test on TestFlight | branch `claude/editorial-feed-preview`: `claude/product-polish` plus the removable "Editorial (Preview)" feed |
| `claude/product-polish` | `ae28ca6`: classic dark mode (a black page, white type), the Memory Room printed on the app's own page with the signature line under each photograph and CONTENTS as a tab, the invitation card's shadow |
| Launch sweep | branches `r12-room`, `r12-stability`, `r12-media`, `r12-flows`, `r12-backend`, `r12-store` merge into `claude/product-polish`, then into the preview branch. A second round fixes what the first handed on; its door part (the two review blockers, the admin pages, unknown addresses) is branch `r13-door` |
| App version | `1.0.0` (`app.json`) |
| Build number | kept by EAS (`appVersionSource: remote`, `autoIncrement: true`); each production build adds one |
| Bundle ID | `com.vintage.social` |
| Name on the home screen | `Vintage` |
| App Store Connect record | `Vintage Social` |
| EAS | project `7d93bd28-2dec-4e7f-8f05-dc2f8c2ecd5f`, owner `chaikatz`, profile `production` (`EXPO_PUBLIC_DEMO_MODE=0`) |
| Devices | iPhone only (`supportsTablet: false`), portrait, iOS 15.1 and later |
| Sign-in | email and password only. No Google, Facebook or other third-party sign-in, so Sign in with Apple is not required (Guideline 4.8) |
| Export compliance | `ITSAppUsesNonExemptEncryption` is `false`: answer "No" if asked |
| Icon | `assets/icon.png`: the V and its rule on cream, 1024 × 1024, no transparency (checked: RGB, no alpha channel). This is the real mark, not Expo's template |
| Launch screen | colour only: white in Light, black in Dark (`ios.splash`). No image, which is allowed |

### Production (Supabase `scfwowqsqrnzpknzurmm`), read on 5 November

- **Accounts (re-read 6 November).** 6 approved members who are people,
  your own account and the review account among them. 150 **house
  accounts**: the club's own accounts, flagged `is_house` (149 approved,
  1 suspended). They cannot sign in, never take a membership number, and
  show the 908 photographs listed in `seed/CREDITS.md`. 5 more people have
  an account but are not members: 4 whose application was rejected and 1
  with no application at all (their profile still reads `applied`; the
  flows area's repair makes the waiting screen say what is true for each).
- 1,139 posts: **908 from house accounts, 231 from members**. 127 posts
  have a point on the map.
- Reports: 2 in all, both dismissed, **0 open**. Applications: 2 approved,
  4 rejected, 0 waiting. Blocks: 0.
- Migrations: everything up to and including **0022** is on production.
  0021 and 0022 were checked by what they made: the message check moved
  to `check_message_not_empty()` and the old `messages_check` constraint is
  gone (0021); the `era_edits` table exists (0022). The dashboard's
  migration list shows only the files that went through the CLI; files run
  in the SQL editor (0009, 0010, 0012, 0019–0022) are not listed there, and
  that is harmless.
- **Pending your approval:** the launch sweep's backend work adds new
  migrations numbered from **0023 up** (0023 to 0038) and changes the
  `push` function. Nothing has been applied. See step 4: run every one of them,
  in number order.
- **Private accounts (read 6 November): apply 0038 before launch.** 7
  accounts are private, all of them house accounts; their 95 followers
  are all house accounts, and 0 follows are waiting as requests. Until
  0038 is applied, the database takes a follow's status from the app, so
  any member could make themselves an accepted follower of a private
  account and see its photographs, and a private member's Accept and
  Decline change nothing. 0038 fixes both for every build, the one in
  TestFlight included.
- Edge function `push`: active (version 1). Daily job `vintage-memories`
  at 15:00 UTC: active. Live push tokens: 5.
- Security advisor: the `SECURITY DEFINER` warnings are the app's RPC
  surface and are by design. **Leaked-password protection is off** (step 7).
- The review account `appreview@vintagesocial.app`: approved, email
  confirmed, not banned, 5 invitations left, invitation link
  `applereview`. It follows 12 accounts, and **all 12 are house
  accounts**, so the reviewer's Home is house photographs. The review
  notes (section 4) say so. Last sign-in 7 October. Its password cannot be
  checked from here (step 6).

### The web (vintagesocial.app), read on 5 November

| Address | Answer |
| --- | --- |
| `https://vintagesocial.app/` | 200, the landing page. `http://` redirects (308) to `https://` |
| `/privacy`, `/terms` | 200, **but the 22 October text** ("Last updated October 22, 2026", and it still says "Darkroom"). The repository's text is dated 6 November. Fixed by redeploying the web (step 3) |
| `/support.html` | 200, **but it is not a support page yet**: any address the web does not know is answered with the app's web shell (title "Vintage", no contact details). It becomes the support page only after step 1 (the file is committed) and step 3 (the web is redeployed). Do not enter the Support URL in App Store Connect (step 9) before then |
| `/i/applereview` | 200, the invitation page |
| `/.well-known/apple-app-site-association` | 404, by design: universal links are not part of 1.0 |

The live web build has no `EXPO_PUBLIC_SUPPORT_EMAIL`. Whether the EAS
production environment has it cannot be seen from here. Without it the
Support row in the app's Settings is hidden, and the Privacy Policy's "the
support address shown in Settings" points at nothing.

### What this pass changed for review

- **Permission sentences** (what iOS shows when it asks on the app's behalf)
  now say what the app does:
  - Add to Photos: "When you choose Save Image or Save Video in the share
    sheet, VINTAGE adds that print to your library. It adds nothing else."
    It used to say the app "does not save anything to your library", but
    the share sheet's Save Image does exactly that, and iOS shows this
    sentence when a member first taps it.
  - Face ID and the old "always" location key were still Expo's template
    words ("Allow $(PRODUCT_NAME) to …"). Neither is ever asked for; both
    now say so in the app's words.
  - Microphone: the camera takes photographs only and nothing records
    sound, so it now says "VINTAGE does not record sound…".
  - Photo library, camera, location (never asked): unchanged.
- **Privacy manifest** (`PrivacyInfo.xcprivacy`, from `app.json` →
  `ios.privacyManifests`): no tracking; the required-reason APIs with
  Apple's codes (UserDefaults CA92.1, file timestamps C617.1, system boot
  time 35F9.1, disk space E174.1); and the data collected, the same list
  as the privacy label in section 3.
- **Terms of Use** now say there is no tolerance for objectionable content
  or abuse of other members, and that a member agrees to them when they
  apply or accept an invitation (Guideline 1.2).
- **Privacy Policy** now also names: the point on the map a typed place is
  looked up to (with Apple's map service); the share notes admins see; the
  phone's make and model kept with the push token; the application's
  "where your photographs live"; and that a print is added to Photos only
  from the share sheet. Dated 5 November 2026.
- **Corrected on 6 November** (the facts were wrong before):
  - An application is kept with the account as the record of the decision
    and deleted with it. (It used to say applications are kept only while
    waiting; nothing ever deletes one.)
  - Deleting an account deletes that member's share links; the notes
    about their shares stay with no account attached. The reports they
    filed stay too, with no account attached, so that they can still be
    acted on: migration 0031 keeps them (until it is applied, step 4, the
    database deletes them with the reporter).
  - A share link shows that one photograph, its place, date and username
    to anyone who has the link, even from a private account, until it is
    turned off or the photograph deleted.
  - Someone whose application is waiting or was not accepted, or whose
    membership is suspended, cannot reach Settings. Their waiting screen
    now has **Delete my account** (two confirmations, as in Settings), and
    the Privacy Policy, the Terms and the support page name it, with
    writing in to the support address kept as a second way. Both
    documents are dated **November 6, 2026**.
  - The Terms say the house accounts are the club's own, show
    public-domain and licensed photographs, and are not members.
- **Support page:** `npm run build:legal` can now write
  `public/support.html` (Guideline 1.5: the Support URL must give a way to
  reach a person), once you give it an address.
- **The door, second round (`r13-door`, 6 November):**
  - The waiting screen has **Delete my account** (Guideline 5.1.1(v)),
    and the invitation says "By accepting you agree to the Terms of Use
    and Privacy Policy" (Guideline 1.2). These were the two review
    blockers.
  - The admin pages (Applications, Members, Reports) send a member who
    is not an admin home when opened by a link; only the dashboard used
    to (Guideline 2.1).
  - An address the app does not know goes home, where it used to open
    Expo's "Unmatched Route" page with a Sitemap of every route, the
    admin pages among them (Guideline 2.1).
  - The waiting screen and the landing page scroll when the largest text
    sizes make them taller than the screen; Sign out, Delete my account,
    Sign in and Privacy · Terms were below the bottom edge.
  - An applicant whose account was made but whose application did not
    reach us goes to the waiting screen, where every retry on the form
    used to say "That username is taken".
  - `seed/CREDITS.md` says above its table what the table says: 679
    Unsplash Licence, 143 public domain, 70 CC0, 16 "no restrictions".

---

## 2. What only you can do, in order

### Before you build: check the two review fixes are in the branch

Both were review blockers on 5 November and are fixed on branch
`r13-door`, which merges into `claude/product-polish` and then into the
preview branch you build. Before step 8, check the branch you build has
both; if either is missing, the merge has not happened yet: ask Claude,
and do not submit until it has.

- **Deleting an account that is not a member's (Guideline 5.1.1(v)).**
  An account whose application is waiting or was not accepted, or whose
  membership is suspended, sees only the waiting screen and cannot reach
  Settings, and the review notes send the reviewer to "Apply for
  membership", which makes exactly this kind of account. Check:
  `app/(gate)/pending.tsx` has a **Delete my account** button under Sign
  out (search the file for `deleteMyAccount`). Step 4 of section 6 tries it
  on the phone.
- **The invitation says what is agreed to (Guideline 1.2).** The review
  notes ask Apple to join with the `applereview` invitation. Check:
  `app/(gate)/invite.tsx` contains "By accepting you agree to the". Step 5
  of section 6 looks for it on the phone.

`npm test` checks both as well (`tests/review-blockers.test.ts`).

Also check the message thread's **"…"** menu is in the branch: the
review notes and the support page say a thread's "…" shows the other
member's profile and lets you report or block them. It is added on branch
`r16-client`. Check: `app/messages/[id].tsx` has a "…" menu with
Report and Block; on the phone, open any thread and tap "…" at the top.

Then do these in this order. Steps 1 and 2 must happen **before** the
build, because the app reads those values when it is built.

### Step 1 · A support address, in the app and on the web

Apple asks for a way to reach a person, both on the Support URL and in
the app. Choose an address you will read (for example a
`support@` address on your own domain).

1. Put it in the app's build settings. On expo.dev: sign in → project
   **vintage** → **Environment variables** → **Add variable** →
   Name `EXPO_PUBLIC_SUPPORT_EMAIL`, Value your address, Environment
   **Production**, Visibility **Plain text** → Save.
   Or in Terminal, in the project folder:
   `npx eas-cli@latest env:set production --name EXPO_PUBLIC_SUPPORT_EMAIL --value you@yourdomain --visibility plaintext`
2. Make the support page. In Terminal, in the project folder:
   ```bash
   SUPPORT_EMAIL=you@yourdomain npm run build:legal
   git add public/support.html && git commit -m "Support page" && git push
   ```
   (It refuses anything that is not an email address. Or ask Claude to do
   it with your address.) Until this file is committed and the web is
   redeployed (step 3), `/support.html` answers with the app's web page
   and no address, so enter the Support URL in App Store Connect only
   after step 3.
3. Optional: add the same `EXPO_PUBLIC_SUPPORT_EMAIL` in Vercel → project →
   **Settings** → **Environment Variables** (Production), so Settings on the
   web shows it too.

### Step 2 · Check the other build settings

On expo.dev → project **vintage** → **Environment variables**, filter
**Production**. It must have:

| Name | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://scfwowqsqrnzpknzurmm.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the production anon key (Supabase → Vintage-Production → Project Settings → API) |
| `EXPO_PUBLIC_INVITE_BASE` | `https://vintagesocial.app` |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | your address, from step 1 |

Without `EXPO_PUBLIC_INVITE_BASE`, Privacy and Terms in Settings open the
app's own copy instead of the web page. That is fine for review; the words
are the same.

### Step 3 · Put the current web pages live

After the launch-sweep branches are merged and pushed, redeploy the web
from the project folder:

```bash
npx vercel --prod
```

Then open, in Safari:

- `https://vintagesocial.app/privacy` → "Last updated November 6, 2026",
  it says "Memory Room", not "Darkroom", and it names "Delete my account"
  for an application that is waiting.
- `https://vintagesocial.app/terms` → "no tolerance for objectionable
  content".
- `https://vintagesocial.app/support.html` → "Support", your address as
  a link, and the Delete your account section, which names both Settings →
  Delete account and Delete my account on the waiting screen. If it shows the app's
  landing page instead, `public/support.html` was not committed (step 1).

### Step 4 · Database changes from the sweep (only after you approve them)

The backend work in this sweep is in the merged branch and is **not**
applied anywhere, staging or production. Read its notes first: the
comment at the top of each file says what it changes, what members would
notice, and how to undo it. If you approve, in the merged branch:

1. Look in `supabase/migrations`. Every file whose number is **0023 or
   higher** is new, and all of them are needed (the table under item 4
   lists them). Do not stop at the ones named here; take the list from
   the folder.
2. Supabase → **Vintage-Production** (`scfwowqsqrnzpknzurmm`) → **SQL
   Editor** → **New query**.
3. Paste the whole of the lowest-numbered new file → **Run**. Wait for
   "Success". Then the next number, and so on: **every file from 0023 up,
   one at a time, in number order**, to the last one in the folder. If
   one fails, stop there and ask Claude; do not skip it.
4. Then run each verify script in `supabase/production` numbered **12 or
   higher** → **Run**, once, after the last file (some rows count what
   later files add, so part-way through they read false).
   Verify script 12 today: `12_policies_read_once_verify.sql`, which checks 0023 to 0038 in 45 rows.
   Every row's `ok` must read true. Each file's own rows, so a false one
   points at its file:

   | File | What it does | Rows |
   | --- | --- | --- |
   | 0023 | Policies read the caller once; an index under every foreign key | 1–13, 20–23 |
   | 0024 | Block checks answer only for the member asking | 14 |
   | 0025 | Home's feed in one request, paged by a cursor | 15–17, 24 |
   | 0026 | A photograph's followers read in order | 18 |
   | 0027 | Expo's push receipts kept for the `push` function | 19 |
   | 0028 | Comments, likes and tags read only with their photograph | 25 |
   | 0029 | A waitlist or rejection reaches the profile; an approval never lifts a suspension | 26–28 |
   | 0030 | A photograph or comment is removed once, and its author told once | 29 |
   | 0031 | A report outlives the member who filed it | 30 |
   | 0032 | A new report reaches the admins' phones (needs item 5) | 31 |
   | 0033 | A photograph a member reports leaves their own view | 32 |
   | 0034 | The house photographs' grid squares at a grid's size: Wikimedia's at 960 pixels wide, Picsum's with a 540-pixel short side | 33–35 |
   | 0035 | A member's own photograph files readable to them whatever their membership, so Delete my account removes them | 36 |
   | 0036 | A phone's push token belongs to whoever signed in on it last | 37 |
   | 0037 | Unread messages counted in the database | 38–39 |
   | 0038 | Follows that respect private accounts: a follow of a private account is always a request, and the account accepts or declines it | 40–45 |

5. Redeploy the `push` function, which changed in the sweep. It is now
   **two files**, `index.ts` and `logic.ts` (`index.ts` imports
   `logic.ts`), so deploy it from the repository with:
   `npx supabase functions deploy push --project-ref scfwowqsqrnzpknzurmm`
   which uploads both. If you use the dashboard instead (Supabase →
   **Edge Functions** → `push` → Code): replace `index.ts` with the
   repository's `supabase/functions/push/index.ts`, add a second file
   named `logic.ts` with the contents of `supabase/functions/push/logic.ts`,
   then deploy. With `index.ts` alone the deploy fails ("module not found
   ./logic.ts") and version 1 stays live. Afterwards, **Edge Functions** →
   `push` must show **version 2 or higher, with both files**.
   0032 (reports reach the admins) needs this redeploy to send anything:
   until then the deployed function answers its calls with "Unknown kind".
6. On a project whose house accounts are seeded after the migrations (a
   fresh project; production's are already there), run
   `0034_seed_thumbnails_at_a_standard_width.sql` again after
   `supabase/production/08_house_accounts.sql`.

Never run anything against `omvezsrkjizxdfeogccw` (staging) by mistake for
production, or the other way round: the project name is at the top left of
the dashboard.

### Step 5 · Check the share link's photograph

On your iPhone: open any of your photographs → the paper plane (Send to)
→ **Share outside VINTAGE** → make a link → open the link in Safari. The
page **and the photograph** should show.

If the page shows but the photograph does not, the key on Vercel and the
one in the database do not match. Fix it once:

1. On your Mac: `openssl rand -hex 32` and copy the output.
2. Vercel → project → **Settings** → **Environment Variables** →
   `SHARE_MEDIA_KEY` → replace the value with it (Production and Preview).
   No quotes, no extra line.
3. Supabase → Vintage-Production → **SQL Editor** → open
   `supabase/production/11_share_media_key.sql`, put the same key in place
   of `PASTE_KEY_HERE`, **Run**. It prints one row with `hash_length 64`.
   Do not save the file with the key in it.
4. `npx vercel --prod`, then try the link again.

### Step 6 · The review account's password

Set a password you know, and check it works, on your Mac in the project
folder:

```bash
npm i --no-save bcryptjs
node scripts/reviewer-password.mjs hash     # type the new password twice; prints SQL holding only its hash
```

Paste the printed SQL into Supabase → Vintage-Production → **SQL Editor**
→ **Run** (it changes that one account's password; its old sessions end).
Then:

```bash
node scripts/reviewer-password.mjs verify   # signs in as the reviewer, checks profile, invitations and feed, signs out
```

Every line should say PASS. Keep the password for App Store Connect
(step 9). Never commit it or paste it into a chat.

### Step 7 · Leaked-password protection

Supabase → Vintage-Production → **Authentication** → **Attack Protection**
(in older dashboards: Policies → Password security) → turn on **Prevent use
of leaked passwords** → Save. Recommended by Supabase's advisor; not a
review blocker. If the switch is greyed out, it needs the Pro plan.

### Step 8 · Build and send to Apple

Decide which branch you are launching:

- `claude/editorial-feed-preview` is what you have been testing, with the
  Editorial (Preview) feed in it;
- `claude/product-polish` is the same app without that experiment.

Then, on your Mac:

```bash
cd ~/Documents/Vintage-Social
git fetch && git checkout <the branch you chose> && git pull
npm install
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --latest
```

The build is a full native build (needed: the sweep changes `app.json` and
native modules, so an over-the-air update is not enough). The build number
goes up by itself. App Store Connect takes about 5–15 minutes to process
it. Install it from TestFlight and go through section 6 before you submit
it for review.

### Step 9 · App Store Connect

Open appstoreconnect.apple.com → **Apps** → **Vintage Social**.

1. **App Information** (left column, under General):
   - Subtitle: `Your best photos aren't new.`
   - Category: Primary **Photo & Video**, Secondary **Social Networking**.
   - Content Rights: **Yes, it contains third-party content**: members'
     photographs, and the house accounts' photographs, which are **not
     yours**. They are other photographers' work: of the 908, 679 are
     under the Unsplash Licence, 143 public domain, 70 CC0 and 16 marked
     "no restrictions" (`seed/CREDITS.md` lists every one, and its header
     gives the same counts). Members grant what the app
     needs in the Terms. Answer "Yes, I have the necessary rights" only
     after you have decided the house-accounts question in section 7.
   - **Age Rating** → Edit → answer as in section 4.
2. **App Privacy** (left column):
   - Privacy Policy URL: `https://vintagesocial.app/privacy`
   - Data collection → **Get Started** → "Yes, we collect data" → tick
     exactly the types in section 3 → for each: the purpose shown,
     **linked to the user: Yes**, **used for tracking: No** → **Publish**.
3. **Pricing and Availability**: Free. Countries as you like.
4. **iOS App → 1.0 Prepare for Submission**:
   - Screenshots: section 5.
   - Promotional text, Description, Keywords: section 4.
   - Support URL: `https://vintagesocial.app/support.html` (only once
     step 3 shows your address on it)
   - Marketing URL: `https://vintagesocial.app`
   - Version: `1.0.0`. Copyright: `© 2026` and the owner's legal name.
   - **Build**: pick the build from step 8.
   - **App Review Information**: Sign-in required **on**. User name
     `appreview@vintagesocial.app`, password from step 6. Your name, phone
     and email as the contact. Notes: paste the text in section 4.
   - **Version Release**: "Manually release this version", so you choose
     the day.
5. **Add for Review** → **Submit to App Review**. If asked about
   encryption: No. About advertising identifier (IDFA): No.

### Step 10 · While in review, and after

- Check **Profile → shield → Reports** at least once a day. The Terms
  promise action within 24 hours, and Apple reads that promise. Once
  migration 0032 is applied and the `push` function redeployed (step 4),
  each admin's phone with notifications on is told "A report is waiting."
  when one is filed; until then nothing tells you, and an admin with
  notifications off is never told.
- If someone writes to the support address asking you to delete their
  account (the Privacy Policy promises this, for members and for
  applications that are waiting or were not accepted, and for suspended
  memberships): first reply suggesting they sign in and use **Delete my
  account** on the screen the app opens on (a member: Settings → Delete
  account), which removes their files and their account itself (for a
  suspended member, once 0035 is applied, step 4). If they cannot, or
  would rather you did it, do it by hand, **whatever the account's
  status**, in this order:
  1. Check the message comes from the account's own email. Supabase →
     Vintage-Production → **Authentication** → **Users** → search the
     email, and copy their **user ID** (shown in the list).
  2. **Storage**: in **each of the three buckets, `avatars`, `media` and
     `thumbnails`**, open the folder named with that user ID, select
     everything in it and delete; repeat until the folder is empty (a
     long folder shows a page at a time). Skip a bucket only if it has no
     such folder. Use the Storage screen, not SQL: deleting rows of
     `storage.objects` in SQL leaves the files themselves in place, and
     they are public by address.
  3. Only then the user's row → **…** menu → **Delete user**. The profile,
     application, posts, comments, likes, follows and messages go with
     it; their files do not, which is why step 2 comes first.
  4. Reply when it is done.
- Apple's reviewer may join with the `applereview` invitation. Each join
  spends one of the review account's 5 invitations and gives the new
  account a real membership number, which is never reissued. Top the
  invitations up in **Admin → Members** if they run low.
- After approval: Vercel → project → **Settings** → **Environment
  Variables** → set `VINTAGE_INSTALL_URL` to the App Store address →
  `npx vercel --prod`. Until then the invitation page says the app is in
  private testing, which is right for TestFlight and wrong once it is public.
- Then **Release This Version** in App Store Connect.
- A lawyer reading the Privacy Policy and Terms is still advised: the facts
  in them are accurate to the app as built; the legal framing has not been
  checked by a lawyer.

---

## 3. App Privacy label (App Store Connect → App Privacy)

The same list is in the privacy manifest (`app.json` →
`ios.privacyManifests`) and in the Privacy Policy;
`tests/store-privacy.test.ts` fails if they drift apart.

Every type below: **linked to the user: Yes · used for tracking: No**.

| Category → type | Purpose | What it is in VINTAGE |
| --- | --- | --- |
| Contact Info → **Name** | App Functionality | the name a member chooses |
| Contact Info → **Email Address** | App Functionality | the sign-in address |
| Contact Info → **Other User Contact Info** | App Functionality | an application's "where your photographs live" (a handle or site), optional |
| User Content → **Photos or Videos** | App Functionality | photographs and films posted; the portrait |
| User Content → **Emails or Text Messages** | App Functionality | messages between members |
| User Content → **Other User Content** | App Functionality | captions, comments, bio, application answers, likes, follows, tags |
| Location → **Precise Location** | App Functionality | the point on the map for the place a member types on a post. Never the phone's position: the app never asks for location |
| Location → **Coarse Location** | App Functionality | the city a member types on their profile or application |
| Identifiers → **User ID** | App Functionality | the account and username |
| Identifiers → **Device ID** | App Functionality | the push token, with the phone's make and model, if notifications are allowed |
| Usage Data → **Product Interaction** | Analytics | the share notes: that a member began a share or made a link, and when the page is opened |

**Not collected:** Health & Fitness, Financial Info, Contacts, Browsing
History, Search History (search history stays on the phone), Purchases,
Sensitive Info, Diagnostics (no crash or analytics SDK), Other Data. The
photo library is **not** collected: the Memory Room reads it on the phone
and only a photograph the member posts is uploaded.

**Tracking: No.** No advertising, no data brokers, no IDFA.

Service providers (not "third parties" for the label): Supabase (database,
sign-in, storage), Expo and Apple (push delivery), Apple (map search),
Vercel (web pages).

---

## 4. App Store Connect text

**Name:** `Vintage Social` (the existing record). The home screen says
`Vintage`.

**Subtitle (≤ 30):** `Your best photos aren't new.`

**Promotional text (optional):** `Membership by invitation.`

**Description:**

> VINTAGE is a private photo club. Membership is by invitation, or by an
> application read by a person.
>
> Post a photograph or a short film with the look of a roll of film — a
> small set of quiet filters, an optional date stamp taken from when the
> shutter actually fired, and the place it was made. Your photographs hang
> on a Timeline by the day they were taken, gather into Eras, sit on a Map
> by where, and are filed by the Places they were made, so a profile reads
> as a life in pictures rather than a grid of thumbnails.
>
> The Memory Room brings back photographs already on your phone, a few at
> a time — this day in other years, a roll from anywhere, the edit of a
> year — so the one worth sharing finds you. It reads your library on the
> phone; nothing leaves it unless you post it.
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

**Keywords (≤ 100 characters):**
`photography,film,vintage,club,invitation,photos,members,timeline,analog,archive`

**Age rating.** In 2025 Apple replaced the 12+ and 17+ ratings with 13+,
16+ and 18+ (the full set is now 4+, 9+, 13+, 16+, 18+). Answer the
questionnaire honestly: user-generated content **Yes**; messaging and chat
**Yes**; advertising **No**; unrestricted web access **No**; parental
controls and age checks **No**; every content category (violence, sexual
content, profanity, drugs, gambling, horror, medical) **None**, because
the Terms forbid it and reports remove it. The Privacy Policy says
members must be **17 or over** (the Terms do not mention age), and there
is no 17+ any more.
Recommended: where App Store Connect offers to set a higher rating than
the one it calculated, choose **18+**, and change "17" to "18" in the
Privacy Policy (one line in `src/legal/documents.ts`, then
`npm run build:legal`; ask Claude), so the store and the policy say the
same age. If you would rather keep 17, accept what Apple calculates as
long as it is 16+ or higher. Never set it lower than Apple calculates. If
your screen still offers 17+, choose 17+ and change nothing.

**App Review notes (paste):** (the sentences about Delete my account and
the invitation's agreement line are true of a build made from a branch
that has `r13-door` merged in; "Before you build" in section 2 says how
to check)

> VINTAGE is a private, invitation-based club for photographs. New members
> join with an invitation from a member, or apply and are approved by a
> person. The account above is already an approved member: on the first
> screen tap "Sign in".
>
> Once in: Home shows photographs from the accounts this account follows,
> newest first. The accounts the review account follows are the club's own
> house accounts: they are not people, they cannot sign in, and they show
> public-domain and licensed photographs so that a new member's Home is
> not empty. They also follow, like and comment on one another's
> photographs: those likes and comments (for example "Where is this?"
> under a photograph in Home) were made by script when the accounts were
> made, not written by people. The Terms of Use say so. Search finds members. The Post tab has two ways in:
> "Enter the Memory Room" shows photographs already in your library, a few
> at a time by the date they were taken (it asks for photo access on its
> first page; limited access works; nothing from the library leaves the
> phone unless you post it), and "Choose a photograph" opens the system
> picker. Pick a photograph, choose a filter, then "Share to VINTAGE".
> Activity lists likes, comments, follows and tags. Profile shows your
> photographs by date posted or taken, as a Timeline, as Eras, on a Map and
> by Places.
>
> Safety (Guideline 1.2). How objectionable content is filtered: by
> admission first. Nobody can post, comment or message without being let
> in, either by a member's invitation (each member has only a few, and an
> invitation is tied to the member who sent it) or by an application that
> a person reads and approves. After that, by people: every report goes to
> a human queue, admins remove content and warn or suspend members, and
> any member can block another. A photograph a member
> reports leaves their own feed, Explore and grids the moment the report is
> sent, and does not come back for them. There is no automatic content
> filter. Members accept the Terms of Use, which say there is no tolerance
> for objectionable content or abuse, when they apply or accept an
> invitation. Every photograph and
> every member's profile has a "…" menu with Report; to report a comment,
> press and hold it. A message thread's "…" menu shows the other
> member's profile and lets you report or block them. A member's profile
> "…" menu also has Block member;
> blocking hides each member's content from the other in both directions,
> and Settings → Blocked members lists and unblocks. Reports go to a human
> queue and are acted on within 24 hours; admins remove content, warn and
> suspend. Support: Profile → Settings → Support, and
> https://vintagesocial.app/support.html.
>
> Account deletion: Profile → Settings (gear, top right) → Delete account,
> then two confirmations. The account and everything it posted are
> removed. Please try this on a second account (below) so the review
> account stays available. An account that has applied but has not been
> let in is deleted from its waiting screen: Delete my account, then two
> confirmations.
>
> To test joining: Settings → Sign out → "I have an invitation" → enter
> the invitation applereview, a name, a new username, any new email and a
> password → "Accept the invitation" (the line beneath it says that
> accepting agrees to the Terms of Use and Privacy Policy, both links).
> That account is approved at once. "Apply for membership" shows the other
> path: the application waits for a person, and the screen says so.
>
> Permissions: photo library (the Memory Room and choosing a photograph),
> camera (taking a photograph), notifications (asked after the first
> sign-in; optional). The add-to-Photos prompt appears only if you choose
> Save Image or Save Video after sharing a photograph outside VINTAGE
> (paper plane → Share outside VINTAGE → Share the print). VINTAGE never
> asks for location: a place on a post is typed or chosen by name. The
> privacy label lists Location only because that typed place is looked up
> to a point on the map and kept with the post; the phone's own position
> is never read. No
> purchases, subscriptions, advertising or tracking. iPhone only, portrait.

---

## 5. Screenshots

App Store Connect needs one set for the largest iPhone display (6.9-inch:
1320 × 2868 or 1290 × 2796, portrait); smaller iPhones are scaled from it.
Take them on your own account, on the real screen, nothing staged. One
short headline above each, nothing else drawn on them.

| # | Screen | Headline |
| --- | --- | --- |
| 1 | Home, two photographs with date stamps and place · date lines | `Your best photos aren't new.` |
| 2 | The Memory Room, a photograph on the page with its signature line | `Rediscover what you already have.` |
| 3 | Your profile, Timeline, three or four entries | `A life in pictures.` |
| 4 | Your profile, Map | `Everywhere you've been.` |
| 5 | A photograph opened, with two or three comments and a tag | `Friends, quietly.` |
| 6 | The editor, a photograph with the filter tray | `Give it the look of film.` |
| 7 | Share outside → the print, in Dark (black) | `Share a print.` |
| 8 | Invitations, with your link and allowance | `Membership by invitation.` |

If you want six, drop 6 and 8.

---

## 6. On your iPhone, on the final TestFlight build (45 minutes)

Have a second account (or a second phone) for steps 9–13, 16 and 18.

**First open**
1. Delete the app, install from TestFlight, open. The landing page shows
   the V and three ways in, and Privacy · Terms at the foot. No flash of
   the wrong colour, in Light and in Dark.
2. Privacy, then Terms: both open, dated November 6, 2026, and come back.

**Joining**
3. Apply for membership with a throwaway email. It lands on Application
   received. Check status says it is still waiting. Sign out.
4. On your own phone: Profile → shield → Applications → Approve (this
   gives the throwaway account a permanent membership number). On the
   applicant: within 30 seconds (or on Check status) it goes in.

   Then sign out, apply once more with a second throwaway email, and on
   Application received tap **Delete my account**. "Delete your account?"
   → Delete account → "Are you sure?" → first tap **Keep my account**: you
   stay on Application received. Tap Delete my account again and answer
   Delete account, then Yes, delete my account → back at the landing page. Signing in with that email now fails
   (Guideline 5.1.1(v)). Nothing is approved, so no number is spent.
5. Sign out. I have an invitation: the card opens with "A member has put
   your name forward", never with "That invitation isn’t one we know"
   (this is the screen the review notes send Apple to). Type an
   invitation: once you stop typing, it names who sent it. Then a new
   email. Under
   Accept the invitation the screen says "By accepting you agree to the
   Terms of Use and Privacy Policy"; tap Terms of Use, it opens, come back
   (Guideline 1.2) → Accept the invitation. Straight into Home, with the
   next member number. This spends one of the inviter's invitations and a
   permanent membership number, which is never reissued, whichever
   invitation you use. Delete this account afterwards in step 20 if you
   like; its number stays spent.

**Every day**
6. Sign in with your own account. Home scrolls and pulls to refresh;
   photographs come in sharp; nothing stutters.
7. Post tab → Enter the Memory Room → Continue → allow access. Turn a few
   pages; open CONTENTS; Develop one → editor → Share to VINTAGE. It
   appears at the top of Home.
8. Post a photograph from Choose a photograph, and a short film. Both play
   and show when opened.
9. From the second account: like and comment on it. Activity shows both;
   a notification arrives if allowed.
10. Send it to the second account (paper plane → a member). Reply from
    the thread.
11. Paper plane → Share outside VINTAGE → Share the print → **Save Image**.
    iOS asks once, with "When you choose Save Image or Save Video in the
    share sheet, VINTAGE adds that print to your library…". Allow; it is in
    Photos. Copy the link instead and open it in Safari: the page and the
    photograph show.
12. Profile → Posted, Taken, Timeline, Eras, Map, Places all open.
13. Settings → Appearance → Dark: the page is black, type white. Back to
    Automatic.

**Safety**
14. On the second account's profile: … → Block member. Their photographs
    leave Home and Search. Settings → Blocked members → Unblock.
15. On any photograph: … → Report → a reason → sent. Press and hold a
    comment → Report comment. Both appear in Profile → shield → Reports.
    In the thread with the second account (step 10), "…" at the top opens
    their profile and has Report and Block.
16. Private accounts (once 0038 is applied, step 4): on the second account,
    Settings → Private account on. From your own account, open its profile
    → Follow: the button reads Requested, and its photographs stay hidden.
    On the second account: Activity says you asked to follow; Settings →
    Follow requests → Accept. Your account now sees its photographs. Then
    Private account off again.
17. Settings shows **Support** with your address (step 1). Tap it: Mail
    opens addressed to you.

**Addresses and text size**
18. On the second account (not an admin), type `vintage://admin/members`
    into Safari's address bar and open it in VINTAGE: it goes to Home,
    with no Suspend or Warn buttons. Then `vintage://no-such-page`: Home
    again, never a page titled "Unmatched Route" or a list of routes.
19. Settings (the phone's) → Accessibility → Display & Text Size → Larger
    Text → turn on Larger Accessibility Sizes and drag the slider all the
    way. Sign out: the landing scrolls to Sign in and Privacy · Terms.
    Apply with a throwaway email: Application received scrolls to Sign
    out and Delete my account (delete it there). Set the text size back.

**Leaving**
20. On the throwaway account: Settings → Delete account → two
    confirmations → back at the landing page. Signing in with that email
    now fails.

---

## 7. Decide before you submit: the house accounts

**What they are.** 150 accounts made by script
(`supabase/production/08_house_accounts.sql`), under invented names,
showing 908 photographs taken by other photographers. They are most of
what a new member sees: 908 of the 1,139 posts, and all 12 accounts the
review account follows. Nothing in the app labels them. The same script
also made them follow, like and comment on one another's photographs
(read on production on 6 November): 1,778 follows, 11,138 likes and
4,182 comments, all between house accounts, the comments from a fixed
list ("Where is this?", "My favourite of yours."). On the 96 photographs
in the review account's Home there are 1,183 of those likes and 450 of
those comments.

**What this pass did.** The Terms now say plainly that some accounts are
the club's own house accounts, show public-domain and licensed
photographs, follow, like and comment on one another's photographs by
script, and are not members. The review notes say the same. The
Content Rights answer (step 9) no longer says the photographs are yours.
Nothing was deleted: whether the house accounts and their likes and
comments stay is yours to decide, below.

**What is still yours to decide** (a lawyer's view is worth having):

- 679 of the 908 are Unsplash photographs (fetched through Lorem Picsum).
  The Unsplash Licence lets anyone use them free, commercially and without
  credit, but it also says it does not include the right to compile photos
  from Unsplash to replicate a similar or competing service. A photo
  club whose Home is mostly Unsplash photographs, posted by invented
  accounts, is close to what that sentence describes. Read the current
  licence at unsplash.com/license before you answer Content Rights.
  (This summary of the licence is from knowledge, not from reading the
  page today.)
- The other 229 are public domain (143), CC0 (70) or marked "no
  restrictions" (16), which carry no such condition.

Three ways forward, and the Content Rights answer follows the one you
choose:

1. **Keep them as they are.** The disclosure in the Terms and the review
   notes stays, likes and comments included.
2. **Keep only the 229** public-domain, CC0 and "no restrictions"
   photographs and remove the 679 Unsplash ones. Nothing has been written
   for this; ask Claude for a reviewed SQL file to run in the SQL Editor,
   like the others.
3. **Remove the house accounts altogether**: the one-line rollback is in
   `supabase/production/README.md` under "House accounts". First have the
   review account follow two or three real members, or its Home is empty,
   and take the house-accounts sentences out of the review notes and the
   Terms (ask Claude; the Terms change is one paragraph in
   `src/legal/documents.ts`, then `npm run build:legal`).

Under 2 and 3 the likes and comments on the photographs removed go with
them. To keep the photographs but remove the scripted likes and comments
(those made by a house account on another house account's photograph),
ask Claude for a reviewed SQL file; the like and comment counts recount
themselves.

---

## 8. Known and accepted for 1.0

- The review account has no membership number (it was made by script, not
  approved through the sequence), so its profile shows no MEMBER line.
  Giving it one would spend a number in the permanent sequence.
- Universal links are not configured. Invitation links open the web page,
  which opens the app with `vintage://` when it is installed.
- `.env.staging` is committed with the **staging** project's publishable
  key, by design. No production value is in the repository.
- Media and thumbnail storage is public-by-address (long random paths), as
  it has always been; the share page adds no exposure.
- Anonymous reads of `posts` and `profiles` error instead of returning
  nothing; nothing anonymous reads them, and no row is exposed.
- The location purpose sentences stay in the app although it never asks
  for location: the linked map and location code is checked by Apple at
  upload for a sentence for each, and they say the app does not track.
- There is no automatic content filter. The review notes say how content
  is filtered: by admission (invitation or an application a person
  reads), then by people (reports, admin removal, blocking). A photograph a
  member reports leaves their own screens the moment the report is sent;
  it stays out of everything they read afterwards only once migration
  0033 is applied (step 4). Until then it comes back the next time those
  screens are read, until an admin acts.
- A report outlives the member who filed it only once migration 0031 is
  applied (step 4); until then, deleting an account deletes the reports
  that member filed, even one still open. The Privacy Policy already says
  they are kept without the account attached (a test holds the policy to
  the migrations), so apply 0031 with the rest before you submit.
