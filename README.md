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
  compose.tsx           filter selection + caption + publish
  post/[id].tsx         post detail + comments
  user/[username].tsx   member profiles
src/
  api/                  supabase queries & rpc wrappers (demo-mode aware)
  demo/                 in-memory demo backend + bundled demo photographs
  components/           reusable UI (PostCard, PhotoGrid, Avatar, …)
  filters/              the VINTAGE filter engine (see below)
  navigation/           the swipeable bottom tab bar
  providers/            session/membership context
  theme/                design tokens (warm paper, hairline borders)
  types/db.ts           database types (mirrors supabase/migrations)
  utils/                validation, time formatting
supabase/
  migrations/           0001 schema · 0002 RPCs · 0003 RLS · 0004 storage
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
- Videos (≤60s) upload as recorded with a poster-frame thumbnail. They live
  in the normal feed and grid — there is no video-specific surface. In this
  first pass the selected filter is stored as metadata but not burned into
  the video (a server-side transcode is the follow-up; see below).
- Storage policies only allow writes inside your own `{user_id}/` folder —
  no member can modify another member's files or rows (see
  `0003_rls.sql` / `0004_storage.sql`).

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
