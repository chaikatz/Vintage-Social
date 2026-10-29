# Editorial feed (preview)

A second way to set out Home's posts, for trying on a phone before deciding
whether to keep it. It is off by default: Settings › Appearance › Feed layout
offers **Original** (the feed as it has always been, and the default) and
**Editorial (Preview)**. The choice is kept on this phone only, in
`Documents/feed-layout.json` (`vintage.feed-layout` in localStorage on the
web). Nothing is stored on the server, nothing changes for other members, and
only Home uses it: profiles, Timeline, the gallery and a post's own page always
draw the original card.

## Where it lives

The experiment is only on the branch `claude/editorial-feed-preview`, which is
`claude/product-polish` plus these files:

| file | what it is |
|------|------------|
| `src/components/feed/EditorialPostCard.tsx` | the editorial card (new) |
| `src/utils/feedLayout.ts` | the preference, kept on the phone (new) |
| `tests/editorial-feed.test.ts` | its guards (new) |
| `EDITORIAL_FEED_PREVIEW.md` | this page (new) |
| `app/(tabs)/index.tsx` | the one seam: which card Home draws |
| `app/settings.tsx` | the Feed layout choice |
| `tests/video-playback.test.ts` | the Home playback guard accepts either card |
| `e2e/launch-test.mjs` | the walk switches it on and off |

`src/components/PostCard.tsx`, `PostMedia`, `PendingPostCard`, `usePostActions`,
uploads, filters, the Memory Room, native modules and Supabase are not touched.

## Keeping it out

Build or merge `claude/product-polish` instead of this branch. It has every
permanent change and none of the experiment.

## Taking it out of a branch that has it

From the repository root, on the branch to clean:

```bash
git rm src/components/feed/EditorialPostCard.tsx src/utils/feedLayout.ts tests/editorial-feed.test.ts EDITORIAL_FEED_PREVIEW.md
git checkout claude/product-polish -- "app/(tabs)/index.tsx" app/settings.tsx tests/video-playback.test.ts e2e/launch-test.mjs
npx tsc --noEmit && npx vitest run
git commit -m "Remove the Editorial feed preview"
```

The `checkout` line is right as long as those four files have not changed on
`claude/product-polish` since; if they have, take the experiment's hunks out of
them by hand instead (`git diff claude/product-polish claude/editorial-feed-preview -- <file>`
shows exactly what to remove). Afterwards
`git diff claude/product-polish -- app src tests e2e` should be empty.

## On phones that tried it

Once the code is gone nothing reads `feed-layout.json`, and everyone sees the
original feed. The file is a few bytes and can be left.
