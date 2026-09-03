# Invitations

One durable link per member, the way a club works: you are given a fixed
number of invitations, your link never changes, and an invitation is spent
when someone actually joins — not when you send it. A link you shared into a
group chat and nobody used costs you nothing.

```
https://<your-domain>/i/chai
```

## Do I need a domain?

**No.** Vercel gives every project a free `*.vercel.app` hostname, and the
invitation link works there exactly as it would anywhere else:

```
https://vintage-social.vercel.app/i/chai
```

Everything in this document works on that hostname. A domain is worth buying
later, for two reasons and no others:

- it reads better in a message from a friend, and
- **universal links** — tapping the link opening the app directly rather than
  a web page first — require a domain you control. `*.vercel.app` cannot serve
  the Apple association file at the apex, so that one upgrade waits.

Nothing else is blocked. Buy the domain when you want it; the links you have
already sent keep working, and you can point the app at the new host by
changing one environment variable.

## The pieces

| Where | What |
| --- | --- |
| `supabase/migrations/0012_invite_links.sql` | the table, the slug rules, and the four functions |
| `app/invites.tsx` | a member's own link: copy, send, rename the suffix, replace it |
| `app/(gate)/invite.tsx` | the joining side, which names the inviter before you fill anything in |
| `app/invite/[slug].tsx` | the `vintage://invite/<slug>` deep link |
| `api/invite.ts` | the web page a stranger lands on, with real link-preview tags |
| `public/invite-card.png` | the 1200×630 card that shows in iMessage |
| `api/aasa.ts` | the Apple association file, once there is a domain |

## Why the page is server-rendered

A link-preview crawler does not run JavaScript. The app's web build is a
single-page bundle, so anything it draws is invisible to iMessage — which is
why an invitation would otherwise arrive as a grey bubble with a bare URL.
`api/invite.ts` returns real HTML with real `og:` tags, so the invitation
arrives looking like an invitation.

The card is a static PNG rather than something generated per request: it is
identical for every invitation, so there is nothing to compute and nothing to
fail at the moment a crawler asks for it. It is also deliberately impersonal —
the inviter's name is on the page, not baked into the image, because a name in
the shared picture could be forged by anyone who edited the URL before passing
it on.

## What the page gives away

`invite_link_owner(slug)` is the only invitation function `anon` may call, and
it returns exactly two things: the inviter's display name, and whether the
link is still open. No member number, no user id, no email, no post count. An
unknown link and a spent link are answered the same way, so the page cannot be
used to test whether a given suffix exists.

## Choosing a suffix

Three to sixty-four characters, lowercase letters, numbers and hyphens, not
starting or ending with a hyphen. Three is the floor because it matches what a
username may be — a member called `chai` should get `/i/chai`, not a random
token. A list of reserved words (`admin`, `vintage`, `support`, `join`, …) is
held back.

A short suffix is guessable, and that is the cost of it reading as your own
name: someone who guessed `/i/chai` could take one of your invitations. The
quota is what bounds the damage — nobody can admit more people than they were
given, and you can see who joined on your invitation and replace the link at
any time. A member who would rather not be guessable can set a longer suffix;
the token issued when a name is unavailable is twelve characters of a
thirty-two letter alphabet, about sixty bits, and is not guessable at all.

## Deploying

1. **Apply the migration.** Paste `supabase/migrations/0012_invite_links.sql`
   into the Supabase SQL editor, then run `supabase/production/09_invite_links.sql`
   to check it took. Do this *before* the next build ships, or the app will
   call functions that are not there yet.

2. **Deploy to Vercel** and set two environment variables, the same values the
   app already uses:

   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

   Both are publishable keys — the page reads through RLS as `anon`, exactly
   as a signed-out visitor does. The service-role key is never used here and
   must not be set.

3. **Point the app at the host** by setting `EXPO_PUBLIC_INVITE_BASE`, e.g.
   `https://vintage-social.vercel.app`. Without it the app falls back to
   `vintage://invite/<slug>`, which works but cannot be sent to someone who
   does not have the app yet.

4. **Optional, once there is a public TestFlight link:** set
   `VINTAGE_INSTALL_URL` on Vercel to the TestFlight join URL. The page then
   offers "Get started" to someone without the app instead of telling them to
   ask the member who invited them.

5. **Optional, once there is a domain:** set `APPLE_TEAM_ID` and
   `APPLE_BUNDLE_ID` on Vercel to turn on the association file at
   `/.well-known/apple-app-site-association`, and add the matching associated
   domain to the iOS build. Until `APPLE_TEAM_ID` is set that route returns
   404 on purpose, so Apple never caches a broken association.

## Checking it after deploy

```sh
curl -sI https://<host>/invite-card.png | head -3          # 200, image/png
curl -s  https://<host>/i/<your-slug> | grep -o 'og:image[^>]*'
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/i/no-such-link   # 404
```

Then paste your own link into iMessage and look at the bubble. That is the
only test that matters.
