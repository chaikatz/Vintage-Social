# VINTAGE

A private, members-only social network for tasteful, low-pressure photo
sharing. iOS-first, built with React Native + Expo and Supabase.

Photography is the center of the product. The feed is strictly
chronological and contains only accounts you follow. There are no Reels,
no Stories, no carousels, no suggested posts, no creator dashboards and no
visible AI features — on purpose.

## Try it on your iPhone (2 minutes)

The fastest way to hold VINTAGE in your hand. No Apple Developer account,
no build, no cost.

1. Install **Expo Go** from the App Store on your iPhone.
2. On your computer, in this folder:

   ```bash
   npm install
   npm run phone
   ```

   Run `npm install` again after every `git pull`. A pull updates
   `package.json`, but installing what it asks for is a separate step, and
   Metro refuses to start when the two disagree:

   ```bash
   git pull && npm install && npm run phone
   ```

3. Point your iPhone's Camera at the QR code in the terminal and tap the
   banner. VINTAGE opens in Expo Go.

Sign in with any email and password — use one containing `admin`
(e.g. `admin@vintage.club`) to get the admin dashboard. It runs against
the bundled demo world: 13 fictional members, 31 photographs, working
feed, likes, comments, follows, posting and moderation.

`npm run phone` serves over your local network, so keep the phone and the
computer on the same Wi-Fi. If they can't be — a locked-down network, a
remote machine — `npm run phone:tunnel` routes through ngrok instead. The
tunnel is slower and needs outbound access to ngrok, which some networks
and sandboxes block outright.

This is the real native app — the GL filter pipeline, haptics, iOS scroll
physics, the system photo picker. Go to the **+** tab, pick a photo from
your camera roll and swipe the filter tray: that's the actual shader, not
the browser approximation.

### If something goes wrong

**"Project is incompatible with this version of Expo Go"** — the project's
SDK and the Expo Go app must match exactly. This project is on **SDK 54**.
Check the SDK your Expo Go supports (shown in the app) and tell whoever
maintains this repo; the project has to move to meet it, since Expo Go
runs only one SDK version at a time.

**`command not found: npm`** — Node isn't installed. Get the LTS installer
from nodejs.org, run it, then reopen Terminal.

**`"<package>" is added as a dependency in your project's package.json but
it doesn't seem to be installed`** — a pull brought in a new library. Run
`npm install`, then start again.

**The QR code won't connect** — check the phone and the computer are on the
same Wi-Fi. If they can't be, use `npm run phone:tunnel`; if *that* fails
with "ngrok tunnel took too long to connect," the network is blocking
ngrok and there is no way around it from that machine.

**Nothing loads / stale screen** — press `r` in the terminal to reload, or
force-close Expo Go and scan again.

**Starting over** — press `Ctrl + C` in the terminal to stop the server,
then `npm run phone` again.

## Stack

| Layer | Choice |
| --- | --- |
| App | Expo SDK 54 · React Native 0.81 · TypeScript (strict) · iOS-first, browser-reviewable |
| Navigation | expo-router (file-based: gate → tabs); the five tabs sit in a swipeable pager (`src/navigation/SwipeTabs.ts`) |
| Data | Supabase — Postgres, Auth, Storage, RLS |
| Client data | @tanstack/react-query |
| Filters | Custom GL pipeline (`src/filters/`) — color matrix + film artifacts |
| Tests | vitest (pure logic: filter math, validation, formatting) |

## Repository layout

```
app/                    expo-router routes
  (gate)/               landing · apply · invite · sign-in · pending
  (tabs)/               home · search · create · activity · profile
  admin/                dashboard · applications · reports · members
  compose.tsx           filter · location · caption · publish
  gallery.tsx           one member's photographs, full size and scrollable
  messages/             the inbox and a one-to-one thread
  share.tsx             send a photograph to members you follow
  requests.tsx          follow requests waiting on a private account
  post/[id].tsx         a single photograph + its comments
  user/[username].tsx   member profiles
src/
  api/                  supabase queries & rpc wrappers (demo-mode aware)
  demo/                 in-memory demo backend + bundled demo photographs
  components/           reusable UI (PostCard, PhotoGrid, Avatar, …)
  filters/              the VINTAGE filter engine (see below)
  hooks/                shared post actions (liking, the "…" menu)
  navigation/           the swipeable bottom tab bar
  providers/            session/membership context
  theme/                design tokens (warm paper, hairline borders)
  types/db.ts           database types (mirrors supabase/migrations)
  utils/                validation, time formatting, EXIF capture dates
supabase/
  migrations/           0001 schema · 0002 RPCs · 0003 RLS · 0004 storage
                        0005 capture date + location
                        0006 direct messages + private accounts
  seed.sql              fictional members, posts, follows, likes, comments
  config.toml           local dev config (email confirmations off)
```

## Browser review (web preview)

iOS is the source of truth; the web build exists so the current UI can be
reviewed in a browser. When no Supabase credentials are configured (or
`EXPO_PUBLIC_DEMO_MODE=1` is set), the app runs in **demo mode** against an
in-memory data layer with the same fictional membership as `seed.sql` —
zero backend required.

### Local web preview

```bash
npm install
npx expo start --web
```

That's it — with no `.env` present it boots straight into demo mode.
On the landing screen: any email/password signs in as a member
(elena.marchetti); an email containing `admin` (e.g. `admin@vintage.club`)
opens the admin dashboard. The application and invite flows, feed, likes,
comments, follows, search, activity, posting, reporting and moderation all
work against the demo store. State resets on refresh (the signed-in demo
user survives via sessionStorage).

To preview the web app against a real Supabase backend instead, fill in
`.env` — demo mode switches off automatically.

### Deploying to Vercel

`vercel.json` is committed, so no manual settings are needed:

```bash
npx vercel        # preview deploy
npx vercel --prod # production
```

Or connect the repo in the Vercel dashboard — the config is picked up
automatically. If you ever configure it by hand, the settings are:

- **Framework preset:** Other
- **Install command:** `npm install`
- **Build command:** `npx expo export --platform web`
- **Output directory:** `dist`
- **Rewrite:** `/(.*)` → `/index.html` (SPA fallback)

Deploy with no environment variables for the demo-mode review site, or set
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` in Vercel to
point the web build at a real backend.

### What's mocked or degraded on web

Native functionality is untouched — these fallbacks apply only to web
builds, and most only to demo mode:

- **Data & auth (demo mode):** in-memory store instead of Supabase; any
  credentials sign in; invite codes only need the right shape; nothing
  persists across refresh.
- **Filters:** the GL shader pipeline is replaced by a CSS approximation
  (`src/filters/cssFilter.ts`) for previews and the publish-time bake —
  close, not pixel-identical; grain is omitted on web. The bundled demo
  photographs ship unfiltered, so their `filter_id` is applied at display
  time; anything published through the app is already baked.
- **Publish bake:** on web the "baked" image comes from a canvas render of
  the CSS approximation, not the GL snapshot.
- **Camera:** hidden on web (library picking works, including for the
  compose flow).
- **Video thumbnails:** not generated on web; the grid falls back to the
  raw media.
- **Dialogs:** native action sheets become `window.confirm`/`prompt`.
- **Haptics:** no-op.

## Running on a real iPhone (EAS development build)

The repo is configured for EAS development builds (`eas.json`, profile
`development`), so the actual VINTAGE app — with the GL filter pipeline and
all native modules — runs on-device without Expo Go. The build installs a
development client; JS is served live from your machine.

One-time founder setup, command by command:

```bash
# 1. Log into Expo/EAS (creates a free account if you don't have one)
npx eas-cli login

# 2. Link this project to your Expo account (writes the projectId into app.json)
npx eas-cli init

# 3. Register your iPhone (opens a link/QR — open it ON the phone,
#    install the provisioning profile it offers)
npx eas-cli device:create

# 4. Build the development app (EAS asks to log into your Apple Developer
#    account the first time and generates certificates for you — say yes)
npx eas-cli build --platform ios --profile development

# 5. Install: when the build finishes, scan the QR code the CLI prints
#    (or open the build link from expo.dev) on your iPhone and tap Install.

# 6. Run it: start the dev server, then open the VINTAGE app on the phone —
#    it connects to this server (same Wi-Fi network)
npx expo start --dev-client
```

After the first build you only ever repeat step 6 for day-to-day work;
rebuild (step 4) only when native dependencies or app config change.

Notes:

- **Apple Developer account** — a paid membership
  (developer.apple.com/programs) is required for on-device builds. EAS
  manages certificates and provisioning profiles on its servers; nothing
  is stored in this repo.
- **Bundle identifier** — `com.vintage.social` is valid and
  fine for development. Before production, confirm it's the identifier
  you want (it becomes permanent once an app ships to the App Store) —
  change it in `app.json` under `ios.bundleIdentifier` *before* your
  first build if not, since EAS registers it with Apple.
- **Backend on device** — the dev client loads JS from your machine, so
  your local `.env` decides: absent → demo mode; filled in → your
  Supabase project. No environment variables need to be configured in
  EAS for development builds.
- **No secrets in the repo** — `.gitignore` excludes `.env`,
  `credentials.json` and signing artifacts; keep it that way.
- `eas.json` also defines `development-simulator` (Xcode simulator
  build), `preview` (installable release-mode build for testers) and
  `production` (App Store build, `autoIncrement`). Nothing submits to
  Apple unless you run `eas submit` yourself.

## Getting started (iOS + Supabase)

### 1. Backend (Supabase)

Local development (requires Docker):

```bash
npx supabase start          # boots Postgres, Auth, Storage, Studio
npx supabase db reset       # applies migrations + seed.sql
npx supabase status         # prints the URL and anon key you need next
```

Or create a hosted project at supabase.com and run the migrations there
(`npx supabase db push` after `npx supabase link`), then run `seed.sql`
via the SQL editor if you want the demo content.

### 2. App

```bash
cp .env.example .env        # fill in EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY
npm install
npm run ios                 # or: npm start
```

> Simulator note: if the app runs in the iOS simulator against local
> Supabase, `http://127.0.0.1:54321` works as-is. On a physical device,
> use your machine's LAN IP in `EXPO_PUBLIC_SUPABASE_URL`.

### 3. Demo accounts

Every seeded account uses password **`vintage-demo`**:

| Account | Role |
| --- | --- |
| `admin@vintage.club` | Admin — approvals, reports, moderation |
| `elena@vintage.club` | Member (Milan) |
| `tomas@vintage.club`, `june@…`, `arthur@…`, `clara@…`, `otis@…`, `margot@…`, `sam@…`, `ines@…`, `niko@…` | Members |

Two applications (`ruby.calloway`, `dex.morrow`) are waiting in the admin
queue, one report is open, and unused invite codes exist (e.g.
`QUET-R2OM`) so every flow can be demonstrated immediately.

### Checks

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest — filter math, presets, validation, time
```

## The gate

Everything you see before you are a member — landing, apply, invitation,
sign in, waitlist — is one piece, and it is deliberately unlike the app
behind it. Inside, the chrome recedes so the photographs carry the screen.
Out here there are no photographs of yours yet, so VINTAGE introduces
itself as a printed object instead: dark stock, gold ink, letterspaced
capitals, a copperplate wordmark (Snell Roundhand on iOS, an italic serif
elsewhere). The navigation header is hidden on all five; each carries its
own back mark.

The landing is one photograph sunk almost to nothing under a brown wash and
a radial vignette — texture in the paper rather than a picture on a poster.
There are no app screenshots, no feature list and no member count: the
point of VINTAGE is that not everyone is inside, so the front door should
read as a closed one.

`src/components/gate/` holds the three shared pieces — the dark layout, the
ruled field, and the struck/ruled buttons — so the five screens cannot
drift apart. `EngravedCard` draws the mitred double rule on the invitation
(a border-radius rounds a corner; this one needs it cut).

## Membership numbers

Every member is given a number when they are let in, counting from 1, and
keeps it. Numbers are issued by the database (`assign_member_no`) at the
two moments someone can enter — an admin approving an application, and a
nomination being redeemed — and by nothing else. They are never reused,
never edited and never reassigned: suspending an account does not free its
number, and reinstating it does not issue a new one.

The first **10,000** are founding members, permanently. The cut-off is on
the number rather than a date or a flag, so it cannot drift — member 9,999
is founding whether they joined on the first day or the last. Profiles show
`FOUNDING MEMBER · NO. 00027`.

The column is system-controlled. The `profiles: update own` policy pins
`member_no` and `invited_by` to their stored values alongside `role`,
`status` and `invite_quota`, so a member cannot set their own number by
writing to their profile.

`invited_by` records who nominated them, permanently, at the moment of
joining — even if that member later leaves.

## Membership model

New users never land in the app directly:

1. **Apply** — name, desired username, profile photo, social handle, city,
   optional inviter, and "Why do you want to join VINTAGE?". The account is
   created in `applied` status; the app shows a pending screen only.
2. **Admin review** — the dashboard (Profile → shield icon) lets admins
   approve, waitlist or reject. Approval grants 3 invitation codes.
3. **Invites** — a member's code (format `ABCD-1234`) admits a new user
   immediately, and the new member receives their own codes.

Statuses: `applied → waitlisted/approved/rejected`, plus `suspended`.
Everything is enforced server-side: RLS only exposes social data to
`approved` members, and all privileged transitions run through
`security definer` RPCs (`decide_application`, `redeem_invite`,
`admin_set_suspension`, …).

## The filter engine

Every post carries exactly one of 14 proprietary filters, defined as pure
data in `src/filters/presets.ts`:

| id | Name | Look |
| --- | --- | --- |
| `archive-bw` | Archive | Silver-print black & white, deep grain |
| `seventy` | Seventy | Faded warm 1970s shoebox print |
| `alpine` | Alpine | Cool alpine film, blue shadows |
| `riviera` | Riviera | Sun-bleached Mediterranean |
| `ninety-eight` | ’98 | Grainy late-90s city night film |
| `instant` | Instant | Polaroid-like soft exposure |
| `chrome-64` | Chrome 64 | Muted Kodachrome-style slide film |
| `neutral-aged` | Plain | Neutral aged film, barely there |
| `ember` | Ember | Last indoor light, shadows going orange |
| `bleach` | Bleach | Colour pulled out, contrast pushed hard |
| `cassette` | Cassette | Off-tracking VHS green |
| `peach` | Peach | Soft pink highlights, kind to faces |
| `midnight` | Midnight | Pushed film after dark, cold and grainy |
| `postcard` | Postcard | Holiday colour, printed a little too bright |

Architecture:

- `types.ts` — a `FilterSpec` is adjustments (brightness/contrast/
  saturation/temperature/tint) + film artifacts (fade lift + paper color,
  vignette, grain) + flags (monochrome, date-stamp default).
- `colorMatrix.ts` — pure, unit-tested math composing a single 4×5 color
  matrix per filter.
- `shader.ts` + `FilteredImage.tsx` — one GLSL program renders every
  filter (matrix → fade → vignette → grain) for live previews **and** the
  publish-time bake (`snapshot()`), so previews and results are identical.
  Photos are baked on every platform, including demo mode — the filter
  ends up in the pixels, never only in the metadata.
- The amber point-and-shoot date stamp is available on **every** filter;
  `dateStampDefault` only decides whether the toggle starts on. It renders
  bottom-right at display time (`DateStamp.tsx`) so it stays crisp and
  re-stylable.

Tuning a filter later = editing numbers in `presets.ts`. Published photos
keep the look they were baked with; posts store the `filter_id` for
attribution and future re-processing.

## Media pipeline

- Photos are baked with their filter on-device (GL snapshot), resized to
  ≤1440px JPEG, plus a ≤480px thumbnail for grids — both uploaded to
  Storage under `{user_id}/{post_id}.jpg`.
- The capture date is read from the file's EXIF at pick time and stored as
  `taken_at`. The amber date stamp shows *that*, not when the post was made
  — a stamp reading today's date on a photograph from last summer is simply
  wrong. Files with no usable EXIF date (screenshots, most videos, anything
  re-saved by an editor) fall back to the posting time.
- Videos (≤60s) upload as recorded with a poster-frame thumbnail — the
  poster is made whether or not it is uploaded, because a grid square can't
  play a movie. They live in the normal feed and grid; there is no
  video-specific surface. Picking one opens the system trimmer on iOS, so a
  long clip is cut to length in the picker instead of being chosen and then
  refused.
- A video's filter is applied live on every play rather than burned into the
  file — burning it in means a server-side transcode VINTAGE doesn't do yet,
  and the original footage is kept intact meanwhile. Photographs are baked,
  so they carry their filter in the pixels.

  **Live filtering cannot use the `filter` style prop on iOS.** React Native
  implements only `brightness` and `opacity` of `filter` there; `saturate`,
  `contrast`, `sepia` and `grayscale` are parsed and then silently dropped
  (`RCTViewComponentView.mm`). Nothing errors — the video simply comes out
  untouched. `src/components/FilterOverlay.tsx` rebuilds the look out of
  `mixBlendMode` layers instead, which iOS does support: a grey plate in
  `saturation` mode to drain colour, `soft-light` for the warm or cool cast,
  `screen` for the fade, and an SVG radial gradient for the vignette.
  Contrast has no honest blend-layer equivalent and is left to the GL bake
  and to web. `FilterOverlay.web.tsx` keeps the CSS path, which is better
  where it works.
- `location` is free text the author types — a town, a street, a bar. It is
  shown under the username beside the filter name. VINTAGE never reads your
  GPS, never places a post on a map, and makes no place searchable.
- Storage policies only allow writes inside your own `{user_id}/` folder —
  no member can modify another member's files or rows (see
  `0003_rls.sql` / `0004_storage.sql`).

## Messages

One-to-one only. No groups, no broadcasts, no requests folder: a member you
can see is a member you can write to. A message carries words, a shared
photograph, or both — the send icon on a post opens a list of the members
you follow and drops the photograph into their thread.

Row-level security gives the two people in a conversation the only read
access there is. **No policy lets a third member read a thread, admins
included** — moderation acts on reports, not on private correspondence.

## Private accounts

A member can make their account private (Settings → Private account). From
then on:

- Following them becomes a request they approve by hand, one at a time.
  The follow button reads "Requested" until they do.
- Their photographs are visible to themselves and to accepted followers.
  This is enforced in the `posts` select policy, not just in the UI, so it
  holds for explore, profiles, the feed and any direct query alike.
- Follower counts only count accepted follows.

Declining a request deletes the row rather than recording a rejection — a
request that was turned down can simply be made again.

## Explore

A second surface under Search: every photograph the viewer is allowed to
see, newest first. No ranking, no "for you", no engagement signal of any
kind — the only reason a picture is near the top is that it was taken
recently. Your own posts are left out, because explore is for finding other
people.

## Nominations

A member does not hand out a referral link. They put someone's name
forward, and that person is admitted on their word — no queue, no review —
with the app recording permanently who vouched for them. The count is
small and does not refill; that is the whole mechanism.

The tables are still called `invites` for schema stability; everything a
member sees is framed as nomination.

## Moderation

Reports (post/comment/member) flow into an admin queue. Admins can warn
members (a note appears in their activity), suspend/reinstate accounts and
remove content — every action is a deliberate human decision recorded in
`moderation_actions`. **Nothing bans or removes automatically**, and no AI
judgment is involved anywhere.

## Requires credentials / external configuration

Everything below needs accounts or secrets that are intentionally not in
this repo:

1. **Supabase project** — create one (or run locally via Docker) and set
   `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`.
2. **SMTP for auth emails** — email confirmations are disabled in
   `supabase/config.toml` so the demo works without a mail server. Before
   production: configure SMTP in Supabase Auth and re-enable
   confirmations.
3. **Apple credentials** — an Apple Developer account for on-device and
   App Store builds. EAS is already configured (`eas.json`); see
   "Running on a real iPhone" above. The iOS bundle id is
   `com.vintage.social` — confirm it before your first build. Camera/photo/microphone
   usage strings are already configured in `app.json`.
4. **App icon & splash** — `assets/` still contains Expo template art;
   replace with VINTAGE marks before shipping.
5. **Push notifications** (optional, future) — not implemented; would need
   APNs keys via EAS.

## Known first-pass limitations

- Video filter rendering: filter is stored, original footage is shown.
  Follow-up: server-side transcode (e.g. an edge function + ffmpeg worker).
- Storage buckets are public-read with unguessable paths; flip to signed
  URLs for fully private media.
- Seed media uses `picsum.photos` placeholder URLs (the client passes
  absolute URLs through), so the demo needs network access; real uploads
  go to Storage.
- `src/types/db.ts` is hand-maintained to mirror the migrations; once a
  project is linked you can regenerate with `supabase gen types`.
