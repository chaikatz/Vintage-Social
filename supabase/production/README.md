# VINTAGE production backend

The runbook for the live Supabase project. Everything here is written to be
run once, in order, against an empty project.

Nothing in this directory contains a credential, and nothing in this
directory should ever be edited to contain one.

---

## What is secret, and what is not

| Value | Where it lives | Safe to share? |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | EAS env + local `.env` | Yes — it ships in the app bundle |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | EAS env + local `.env` | It ships in the app bundle, so it is public **by design** — but RLS is the only thing standing behind it, so still don't paste it around |
| `service_role` key | Supabase dashboard only | **No. Never.** It bypasses RLS entirely |
| Database password | Supabase dashboard only | **No. Never.** |

The anon key being in the bundle is not a leak: every policy in `0003_rls.sql`
and `0006_messages_and_privacy.sql` assumes an untrusted client holding it.
The `service_role` key assumes the opposite, which is why it never leaves the
dashboard and never appears in this repository, in a build, or in a chat.

---

## Order of operations

Run these against the production project, in this order, and stop at any step
whose output is not what it says to expect.

**1. Audit — confirm the project is empty**

```
supabase/production/01_audit_before.sql
```

Every count must be `0` (except `pgcrypto`, where either answer is fine). A
non-zero anywhere means the project is not clean; stop and find out why
before continuing.

**2. Apply the migrations, in order, one at a time**

```
supabase/migrations/0001_schema.sql
supabase/migrations/0002_functions.sql
supabase/migrations/0003_rls.sql
supabase/migrations/0004_storage.sql
supabase/migrations/0005_post_details.sql
supabase/migrations/0006_messages_and_privacy.sql
supabase/migrations/0007_member_numbers.sql
```

Order is not negotiable: `0003` writes policies against tables `0001` creates,
and `0007` rewrites two functions `0002` defines and one policy `0003` writes.

**Never run `supabase/seed.sql` here.** It inserts thirteen fictional members
straight into `auth.users`, and they would take founding numbers 1–11.

**3. Verify**

```
supabase/production/03_verify_after.sql
```

The last row is the one that matters:

```
NEXT MEMBER NUMBER WILL BE    1    1 expected
```

If that says anything other than `1`, a number has already been issued.
Do not create the founder's account until it says `1`.

---

## Auth settings

In the dashboard, **Authentication → Providers → Email**:

- **Confirm email: OFF.** `submitApplication` and `joinWithInvite` both call
  `signUp` and use the returned user immediately. With confirmations on,
  Supabase returns no user and the flow fails with "Sign-up did not return a
  user." This is a hard requirement, not a preference.
- Leave every other provider off. VINTAGE has one way in.

**Authentication → URL Configuration**: no redirect URLs are needed. The app
never uses magic links, OAuth or password recovery flows.

---

## Storage

Migration `0004` creates the three buckets (`avatars`, `media`,
`thumbnails`) and their policies. Nothing to do by hand. The buckets are
public-read with unguessable UUID paths; writes are restricted to a member's
own `{user_id}/` folder, and post media additionally requires active
membership.

---

## Environment variables

Production values live in the **EAS "production" environment**, never in git:

```bash
eas env:create --environment production \
  --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref>.supabase.co"

eas env:create --environment production \
  --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>" --visibility sensitive
```

`eas.json` pins the mode per profile, so this cannot go wrong by accident:

| Profile | `EXPO_PUBLIC_DEMO_MODE` | Backend |
| --- | --- | --- |
| `development` | `1` | demo, in-memory |
| `preview`, `preview-simulator` | `1` | demo, in-memory |
| `production` | `0` | this Supabase project |

Preview builds are pinned to demo **even if** the machine building them has a
real `.env`. Local `npm run phone` has no `.env` at all, so it is demo too.
Only the production profile talks to the live backend.

The web preview (Vercel, and the review artifact) has no Supabase variables
set and therefore stays in demo mode. Leave it that way: it is a public URL.

---

## After the founder exists

Once member no. 1 is created and confirmed, consider turning the Supabase
connector's write access off again. It exists to do this setup; leaving a
write-capable connection to a live members' database open is a standing risk
with no matching benefit.
