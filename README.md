# VINTAGE

A private, members-only social network for tasteful, low-pressure photo
sharing. iOS-first, built with React Native + Expo and Supabase.

Photography is the center of the product. The feed is strictly
chronological and contains only accounts you follow. There are no Reels,
no Stories, no carousels, no suggested posts, no creator dashboards and no
visible AI features — on purpose.

## Stack

| Layer | Choice |
| --- | --- |
| App | Expo SDK 57 · React Native 0.86 · TypeScript (strict) |
| Navigation | expo-router (file-based: gate → tabs) |
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
  api/                  supabase queries & rpc wrappers
  components/           reusable UI (PostCard, PhotoGrid, Avatar, …)
  filters/              the VINTAGE filter engine (see below)
  providers/            session/membership context
  theme/                design tokens (warm paper, hairline borders)
  types/db.ts           database types (mirrors supabase/migrations)
  utils/                validation, time formatting
supabase/
  migrations/           0001 schema · 0002 RPCs · 0003 RLS · 0004 storage
  seed.sql              fictional members, posts, follows, likes, comments
  config.toml           local dev config (email confirmations off)
```

## Getting started

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

Every post carries exactly one of 8 proprietary filters, defined as pure
data in `src/filters/presets.ts`:

| id | Look |
| --- | --- |
| `archive-bw` | Silver-print black & white, deep grain |
| `seventy` | Faded warm 1970s shoebox print |
| `alpine` | Cool alpine film, blue shadows |
| `riviera` | Sun-bleached Mediterranean |
| `ninety-eight` | Grainy late-90s city night film |
| `instant` | Polaroid-like soft exposure |
| `chrome-64` | Muted Kodachrome-style slide film |
| `neutral-aged` | Neutral aged film, barely there |

Architecture:

- `types.ts` — a `FilterSpec` is adjustments (brightness/contrast/
  saturation/temperature/tint) + film artifacts (fade lift + paper color,
  vignette, grain) + flags (monochrome, date-stamp support).
- `colorMatrix.ts` — pure, unit-tested math composing a single 4×5 color
  matrix per filter.
- `shader.ts` + `FilteredImage.tsx` — one GLSL program renders all eight
  filters (matrix → fade → vignette → grain) for live previews **and** the
  publish-time bake (`snapshot()`), so previews and results are identical.
- Filters marked with `dateStamp` offer the amber point-and-shoot date
  stamp, rendered bottom-right at display time (`DateStamp.tsx`) so it
  stays crisp and re-stylable.

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
3. **Apple credentials** — an Apple Developer account, bundle id
   (`club.vintage.app` is a placeholder) and EAS setup (`npx eas init`,
   `eas build`) for TestFlight/App Store builds. Camera/photo/microphone
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
