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
supabase/migrations/0008_function_grants.sql
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

## The RPC surface

`0008` exists because of something the Supabase security advisors caught on
the live project, and it is worth understanding rather than just running.

PostgREST publishes every function in `public` at `/rest/v1/rpc/<name>`, and
PostgreSQL grants `EXECUTE` to `PUBLIC` by default. Between them, every
internal helper was reachable by anyone holding the anon key. Most were
harmless — the trigger functions error if called directly, and every
`admin_*` function raises `Admins only` before doing anything.

One was not. `assign_member_no(uuid)` is `SECURITY DEFINER` with no guard of
its own, because it was only ever meant to be called from inside
`decide_application` and `redeem_invite`. Exposed, it let any caller burn
membership numbers, or hand one to an account nobody had approved.

`0008` revokes execute across the schema and grants back only what the
client calls. Two grants must stay or the app breaks:

- `is_admin` and `is_active_member` are called from inside RLS policies.
  Policy expressions evaluate as the querying role and a function call in
  one needs `EXECUTE` — revoke these and every policy using them fails with
  "permission denied for function".
- `username_available` is called before sign-up, while the caller is anon.

Trigger functions need no grant at all: `EXECUTE` is checked when the
trigger is created, not each time it fires.

The advisors still report the functions that were deliberately kept
reachable. That is expected — each one guards itself, or a policy needs it.

## The founder

`04_bootstrap_founder.sql` turns the application submitted through the app
into member no. 1. Run it once, after submitting, editing only the username
on the marked line.

It creates nothing — the account and profile already exist, made by the
app's sign-up and the `on_auth_user_created` trigger. It promotes the
profile to admin, settles the application so the queue does not still show
the founder pending, sets the founding quota, and issues the number through
`assign_member_no`, the same protected function the two approval paths use.

Its preconditions are checked *before* the number is drawn, and that
ordering is the point. A sequence is deliberately not transactional:
`nextval()` sticks even when the surrounding transaction rolls back,
because two sessions must never receive the same number. A block that drew
a number and then failed an assertion would roll back the profile write and
leave the counter advanced — number 1 gone, a retry issuing 2. So the block
verifies that nothing is numbered and the counter is untouched first, and
the closing assertion is a second line of defence that should never fire.

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

## Fixing publishing (migration 0009)

**Symptom.** An approved member publishes a photograph and gets
`Couldn't publish — new row violates row-level security policy`.

**Cause.** The client uploads with `upsert`, and the storage API turns that
into `insert ... on conflict (bucket_id, name) do update`. PostgreSQL applies
the **SELECT** policy to that statement, because it has to be able to look at
the row it might conflict with. `storage.objects` had no SELECT policy at
all, so the statement was refused — before any conflict could even occur, so
even the first upload of a brand-new key failed. The write policies in
`0004_storage.sql` were correct all along, which is why this looked like a
policy-expression bug rather than a missing policy.

The post insert was never the problem. Only the two storage uploads were.

**Apply it.**

1. Run `supabase/production/05_fix_publish_rls.sql` in the SQL Editor. It is
   the contents of `supabase/migrations/0009_storage_read_own.sql`, and it
   only *adds* two read policies — nothing is revoked, no existing policy is
   relaxed, no data is touched. It is safe to re-run.

2. Run `supabase/production/06_verify_publish.sql`, having replaced the uuid
   at the top with your own (`select id, username from public.profiles;`).
   Everything it does is rolled back, so it creates no post and stores no
   object. It should report:

   ```
   media upload: OK; thumbnail upload: OK; post insert: OK;
   another member's folder: correctly denied;
   ```

   Before the fix, the two uploads say `FAILED` and the post insert says
   `OK` — which is the same split the app shows.

3. Publish a real photograph from the app.

**What the new policies allow.** A signed-in member may read the
`storage.objects` rows for files in their own folder — their own uploads,
nothing else. Not another member's folder, not a listing of a bucket, and
nothing for a signed-out visitor. Media and thumbnail reads additionally
require active membership, so a suspended member cannot overwrite their own
media either. Downloads are unaffected in both directions: the buckets are
public-read and served without consulting this table.

**Regression cover.** `npm run test:rls` applies every migration to a
throwaway PostgreSQL and asserts 25 publish-policy behaviours — who may
publish, who may upload where, and both the plain-insert and upsert shapes.
Removing `0009` from `supabase/migrations/` makes it fail, which is how the
fix was confirmed to be the thing doing the work.

---

## Invitation wording (migration 0010)

Cosmetic, and safe to leave until convenient. The app now says
"Invitations" throughout, but three strings live in the database rather than
the client and still said "nomination" — two errors from `create_invite`,
and the note written into an inviter's Activity feed when their invitation
is taken up, which is the one members actually see.

Run `supabase/production/07_invitation_wording.sql`. It is the definitions
currently in production, character for character, with only those three
strings changed: same signatures, same `SECURITY DEFINER`, same
`search_path`, same logic. `create or replace` keeps the grants made in
0008, and `npm run test:rls` asserts that — `assign_member_no` stays
unreachable, `create_invite` and `redeem_invite` stay callable by members
and not by `anon`.

---

## After the founder exists

Once member no. 1 is created and confirmed, consider turning the Supabase
connector's write access off again. It exists to do this setup; leaving a
write-capable connection to a live members' database open is a standing risk
with no matching benefit.
