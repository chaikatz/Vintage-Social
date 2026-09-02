# Seed — the house photographs

VINTAGE ships with a body of photography of its own so that Explore and
Search are not empty when the first real members arrive. This directory
builds it.

```bash
npm run seed:curate            # query Wikimedia Commons  -> seed/photos.json
node seed/curate.mjs --clean   # re-apply the photo test to photos.json, no network
npm run seed:build             # -> supabase/production/08_house_accounts.sql, seed/CREDITS.md
npm run test:rls               # applies the result to a throwaway database and checks it
```

## What it will and will not use

Only **public domain and CC0** images. Those are the licences with no
attribution condition and no share-alike obligation, and the second one
matters as much as the first: VINTAGE applies a filter to everything it
shows, which makes each displayed frame a derivative work. Under CC BY-SA
the app would inherit the licence; under CC BY every card would owe a
visible credit. `seed/CREDITS.md` lists every source file regardless, so
provenance is always traceable.

Commons is as much a scanning project as a photo library, so
`photoFilter.mjs` throws out the two families that are not photographs:
paintings and prints, and scanned pages, catalogues and journals. Both are
matched on the filename and the file's own object title, never on the
description — photographers write "print", "plate" and "portrait" about
photographs constantly. The rules are unit-tested in
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
