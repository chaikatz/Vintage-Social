# Seed — the house photographs

VINTAGE ships with a body of photography of its own so that Explore and
Search are not empty when the first real members arrive. This directory
builds it.

```bash
npm run seed:curate            # query Wikimedia Commons  -> seed/photos.json  (~25 min)
node seed/curate.mjs --picsum  # add the contemporary set  -> appends to photos.json
node seed/curate.mjs --clean   # re-apply the photo test to photos.json, no network
npm run seed:build             # -> supabase/production/08_house_accounts.sql, seed/CREDITS.md
npm run test:rls               # applies the result to a throwaway database and checks it
```

## Two sources, and why

**Wikimedia Commons**, filtered to public domain and CC0. Subject-accurate —
searching for Positano returns Positano — so a photograph from a place theme
can carry that place honestly. The catch is that it skews archival: most of
what is old enough to be out of copyright was shot before about 1930. It is
handsome, and on its own it reads as a museum rather than as people posting
this year.

**Lorem Picsum's catalogue** of about a thousand Unsplash photographs, which
is contemporary and in colour. The Unsplash licence permits commercial use
with no attribution required — the same freedom the public-domain material
gives. There is no subject metadata, so these carry no location: better to
say nothing about where a photograph was taken than to guess.

The build weights the contemporary set to about three quarters of the feed,
with the archival material as the remainder. That mix suits an app called
VINTAGE better than either source alone.

## Licensing

Only **public domain, CC0 and Unsplash-licensed** images. Those are the licences with no
attribution condition and no share-alike obligation, and the second one
matters as much as the first: VINTAGE applies a filter to everything it
shows, which makes each displayed frame a derivative work. Under CC BY-SA
the app would inherit the licence; under CC BY every card would owe a
visible credit. `seed/CREDITS.md` lists every source file regardless, so
provenance is always traceable.

Commons is as much a scanning project as a photo library, so
`photoFilter.mjs` throws out the families that do not belong:
paintings and prints, and scanned pages, catalogues and journals. Both are
matched on the filename and the file's own object title, never on the
description — photographers write "print", "plate" and "portrait" about
photographs constantly.

It also drops photographs that are real, and public domain, and wrong for
this: government and news archives are a large share of what is out of
copyright, and searching for "vintage car street" returned a news picture of
a protester being struck by one. A photograph of somebody's worst day,
posted under an invented name as though a member had taken it, is exactly
the thing not to ship. The rules are unit-tested in
`tests/photoFilter.test.ts`; when something ugly gets through, add the case
there, tighten the rule, and re-run `--clean` rather than the full query.

## What the accounts are

House accounts, flagged `is_house` in the database. They post, they can be
followed and searched, and they cannot sign in — the auth rows carry no
password. They never take a membership number: migration `0011` makes
`assign_member_no` refuse them before it touches the sequence, so the first
real invitation is still `NO. 00002`. `npm run test:rls` asserts it.

They are also, plainly, not people. Members will follow them and comment at
them and nothing will answer. `supabase/production/README.md` has the
one-line rollback for when that stops being a trade worth making.
