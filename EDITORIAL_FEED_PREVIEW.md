# Editorial feed (preview)

A second way to set out a feed's posts, for trying on a phone before
deciding whether to keep it. It is off by default: Settings › Appearance ›
Feed layout offers **Original** (the feed as it has always been, and the
default) and **Editorial (Preview)**. While Editorial is chosen, a second
row under it offers the **Paper**: **Off-white** (the app's own paper, and
the default) or **White**. Each choice is kept on this phone only, in
`Documents/feed-layout.json` and `Documents/feed-paper.json`
(`vintage.feed-layout` and `vintage.feed-paper` in localStorage on the
web). Nothing is stored on the server and nothing changes for other
members.

Two screens use it: Home, and the gallery, the feed a member's
photographs open into from their profile grid (and from Search, an era
and On this day). A post's own page, the timeline and every other screen
always draw the original card.

Editorial sets each post out as a print, the way a photograph is shared
from VINTAGE (`src/components/ExportCard.tsx`). Above the picture, where the
original card has them, the member's picture and name, which open their
profile, and the "…" at the end of that line. Then the picture inset on the
paper with the print's margins, the hairline rule under it, and under the
rule the print's label: on the right, as on the print, the place and the
date in full in the typewriter face; on the left, where the wordmark is
printed, the like, comment and send buttons. There are no counts, no
`@name` on the label, no wordmark, no "Members only" and no membership
number. Then the caption after the member's name, the way a comment is
written, the newest comments, and last, in the label's typewriter capitals,
when it was posted (`29M AGO`). Prints are separated by the paper alone.

The whole feed is one paper, never two: the screen behind the prints, every
print, and the bars around them. On Home that is the bar with the wordmark
and the tab bar too, for as long as Home is in front (the tab bar takes its
style from the tab in front, so it follows Home cleanly and goes back to
the app's paper on the other tabs). In the gallery it is the bar with the
member's name. In the dark appearance both papers are the dark print's
brown.

One thing does not follow the paper: while a new post is still on its way
up, its card at the top of Home (`PendingPostCard`) stays on the off-white
until it is posted and the print takes its place.

## Where it lives

The experiment is only on the branch `claude/editorial-feed-preview`, which is
`claude/product-polish` plus these files:

| file | what it is |
|------|------------|
| `src/components/feed/EditorialPostCard.tsx` | the editorial card (new) |
| `src/utils/feedLayout.ts` | the layout preference, kept on the phone (new) |
| `src/utils/feedPaper.ts` | the paper preference, kept on the phone, and the paper a feed lies on (new) |
| `tests/editorial-feed.test.ts` | its guards (new) |
| `EDITORIAL_FEED_PREVIEW.md` | this page (new) |
| `app/(tabs)/index.tsx` | Home's seam: which card it draws, and the paper under it |
| `app/gallery.tsx` | the gallery's seam: which card it draws, the paper under it and its bar's |
| `app/(tabs)/_layout.tsx` | Home's wordmark bar and tab bar on the paper |
| `app/settings.tsx` | the Feed layout and Paper choices |
| `tests/video-playback.test.ts` | the Home and gallery playback guards accept either card |
| `e2e/launch-test.mjs` | the walk switches it on and off, reads a print, tries both papers and opens a gallery |

`src/components/PostCard.tsx`, `PostMedia`, `PendingPostCard`, `usePostActions`,
uploads, filters, the Memory Room, native modules and Supabase are not touched.

## Keeping it out

Build or merge `claude/product-polish` instead of this branch. It has every
permanent change and none of the experiment.

## Taking it out of a branch that has it

From the repository root, on the branch to clean:

```bash
git rm src/components/feed/EditorialPostCard.tsx src/utils/feedLayout.ts src/utils/feedPaper.ts tests/editorial-feed.test.ts EDITORIAL_FEED_PREVIEW.md
git checkout claude/product-polish -- "app/(tabs)/index.tsx" app/gallery.tsx "app/(tabs)/_layout.tsx" app/settings.tsx tests/video-playback.test.ts e2e/launch-test.mjs
npx tsc --noEmit && npx vitest run
git commit -m "Remove the Editorial feed preview"
```

The `checkout` line is right when the branch has every change
`claude/product-polish` has made to those six files (as it does just after
merging it) and no change of its own to them besides the experiment's. If
not, take the experiment's hunks out of them by hand instead
(`git diff claude/product-polish claude/editorial-feed-preview -- <file>`
shows exactly what to remove). In `app/gallery.tsx` those are the three
imports (`EditorialPostCard`, `useFeedLayout`, `useFeedBackground`), the
`FeedCard` and `paper` lines with the comment above them, `style={paper}` on
the `Screen`, `headerStyle: paper …` in the `Stack.Screen` options, and
`<FeedCard`, which goes back to `<PostCard`. Afterwards
`git diff claude/product-polish -- app src tests e2e` should be empty, and
`git grep -n -e EditorialPostCard -e feedLayout -e feedPaper -e useFeedBackground -- app src tests e2e`
should find nothing.

## On phones that tried it

Once the code is gone nothing reads `feed-layout.json` or `feed-paper.json`,
and everyone sees the original feed on the app's paper. The files are a few
bytes each and can be left.
