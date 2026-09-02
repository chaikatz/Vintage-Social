# VINTAGE staging

A second Supabase project holding the 150 house accounts and their
photographs, so you can browse a populated VINTAGE on your phone while
production stays a clean, empty club.

|  | Staging | Production |
| --- | --- | --- |
| Project | `Vintage-Staging 09/02/26` | `Vintage-Production 09/01/26` |
| Ref | `omvezsrkjizxdfeogccw` | `scfwowqsqrnzpknzurmm` |
| Region | us-west-1 | us-west-2 |
| Contents | 150 house accounts, ~908 photographs, video | your account, nothing else |
| Costs | $10/month while it exists | — |

They share nothing: separate projects, separate databases, separate keys.
Nothing in staging can reach production, and the switch below only ever
rewrites your local `.env`.

---

## Switching your phone between the two

```bash
npm run use:staging       # point the local app at staging
npm run use:production    # point it back
npm run env               # just say which one is active, change nothing
```

Each switch prints the project it now points at, in words:

```
──────────────────────────────────────────────────────────
  VINTAGE is now pointed at: STAGING  (omvezsrkjizxdfeogccw)
  House accounts and seeded photographs. Nothing here is real.
──────────────────────────────────────────────────────────
  Restart the dev server for it to take effect:  npm run phone
```

Metro reads `.env` when it starts, so **restart `npm run phone` after
switching** — the script says so every time. If you are ever unsure what the
app on your phone is talking to, run `npm run env`.

`.env.staging` is committed; `.env.production` is not. Create it once from
`.env.production.example` with the anon key from Supabase → Project Settings
→ API. Until you do, `npm run use:production` refuses and tells you what is
missing rather than silently leaving you on staging.

---

## Filling staging (once)

Staging already has all eleven migrations applied. Three things remain, all
run from the Supabase SQL Editor **with the staging project selected** —
check the ref in the URL is `omvezsrkjizxdfeogccw` before each one.

**1. The house accounts.** Paste `supabase/production/08_house_accounts.sql`
— the same file production would use. It runs in one transaction and prints
a summary; `should_be_zero` must be `0` and `member_no_seq` must be `1`.

**2. Your own account.** Point the app at staging and sign up through it,
exactly as a real member would. Your staging password is yours; it is never
typed into a file or a chat. Then edit the username at the top of
`01_bootstrap_founder.sql` and run it. It refuses to promote a house
account, and it will report you as `no. 00001` — which is the point: 150
house accounts came first and took no numbers at all.

**3. Video.** Run `02_videos.sql`. The house seed is photographs only, so
without this there is nothing to check video against. These are Google's
public sample clips, the same ones the demo fixtures use — fine for a
private test environment, not something to ship to members.

Then run `03_verify.sql`. It reads everything the way the app does — as an
ordinary approved member, through row-level security, not as the owner —
and reports what your phone should be able to see.

## What a good verification looks like

```
house_accounts | house_with_numbers | real_accounts | real_members         | next_number_will_be
           150 |                  0 |             1 | you = no. 00001      |                   2

 posts | videos | follows | likes | comments | private_accounts | avg_posts_per_account
   914 |      6 |    ~1700 | ~11000 |    ~4100 |                7 |                   6.1

 house_with_passwords | house_auth_rows
                    0 |             150
```

The three that matter:

- **`house_with_numbers` is 0.** House accounts never draw a membership
  number. Migration `0011` makes `assign_member_no` refuse them *before* it
  calls `nextval`, because a sequence number drawn and rolled back is spent
  for good.
- **`next_number_will_be` is 2** once you have bootstrapped yourself. Your
  first real invitee is `NO. 00002`, with 150 seeded accounts sitting in
  front of them taking nothing.
- **`house_with_passwords` is 0.** None of them can sign in. There is no
  password and no identity row to authenticate against.

## What to look at on the phone

- **Explore** — several screens of photographs, from members you do not
  follow. This is the surface the seed exists for.
- **Feed** — empty at first, and that is correct: a new member follows
  nobody. Follow a few accounts from Explore or Search and it fills, newest
  first.
- **Search** — 150 names and cities.
- **A profile** — a grid of six or so, a bio, a city, follower counts that
  are real because the triggers counted them.
- **Likes and comments** — already on the photographs, so the counts and the
  inline previews under a post have something to show.
- **Video** — six posts. Check autoplay follows the card you are looking at,
  the speaker button turns sound on, and the filter is applied to the moving
  picture.
- **Your own profile** — `FOUNDING MEMBER · NO. 00001`.
- **Seven private accounts** — their photographs must not appear in Explore
  until you follow them and they accept.

---

## When you are finished

Staging costs $10/month for as long as it exists.

- **Pausing** it (Supabase → Project Settings → Pause) stops the charge and
  keeps the data, ready to resume.
- **Deleting** the project removes it entirely. Nothing else depends on it —
  production has never referenced it, and the only local trace is
  `.env.staging`.

To empty staging without deleting the project:

```sql
delete from auth.users where id in (select id from public.profiles where is_house);
delete from public.posts where media_type = 'video';
```

## Keeping it honest

`npm run test:rls` applies every migration, the house seed **and these three
staging scripts** to a throwaway PostgreSQL, then asserts 46 behaviours
including the numbering guarantee. So the runbook on this page is executed
on every test run, not just read.
