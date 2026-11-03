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
paper with the print's margins, the hairline rule under it, and just under
the rule the print's label: on the right, as on the print, the place and the
date in full in the typewriter face; on the left, where the wordmark is
printed, the like, comment and send buttons. There are no counts, no
`@name` on the label, no wordmark, no "Members only" and no membership
number. Then the caption after the member's name, the way a comment is
written, the newest comments, and last, in the label's typewriter face,
when it was posted (`29m ago`).

Only the picture keeps the print's margins. Everything around it is set
where Instagram sets it: the member's picture and name, the buttons, the
caption, the comments and the posted line start 12 pt in from the left of
the screen, the "…" and the label end 12 pt in from the right, and the
hairline runs between the same two edges. One post follows the next about
as closely as on Instagram, separated by the paper alone.

The whole feed is one paper, never two: the screen behind the prints, every
print, and the bars around them. On Home that is the bar with the wordmark
and the tab bar too, for as long as Home is in front (the tab bar takes its
style from the tab in front, so it follows Home cleanly and goes back to
the app's paper on the other tabs). In the gallery it is the bar with the
member's name. In the dark appearance both papers are the dark print's
brown.

A post still on its way up lies on the same paper: its card at the top of
Home (`PendingPostCard`) has no paper of its own, a permanent change that
is on `claude/product-polish` too.

## Usernames

While Editorial is chosen, every username the app draws as a name is set in
the face the print sets its credit in (`@chai · MEMBER NO. 00001`), the
typewriter face `type.mono`, everywhere in the app and not only in the feed:
the member's name over each print and before its caption and comments, the
bar's title where it is a username (the Profile tab, a member's profile,
their gallery, a message thread), every list of members (Search and its
recent searches, Followers and Following, Likes, Requests, Blocked members,
Send to, Tag people, the inbox), the notices in Activity, the Comments
screen, a post's own page, the card of a post on its way up, a private or
blocked profile's lines, and the admin's Applications, Reports and Members.
Only the face changes: each name keeps its size, weight, colour, spacing and
place. Under Original nothing changes.

Display names, what a member types into a field, and what members wrote
(captions, comments, messages) keep their own face. So do the system's own
dialogs and menus, whose face the app cannot set, the avatar's initial, and
two sentences built as plain text by components the experiment leaves alone:
the empty Followers and Following lists ("Nobody follows … yet.", from
`EmptyState`) and the empty Eras view (from `erasEmpty`).

`src/utils/nameFace.ts` holds it: `useNameFace()` is added to a name's style
(the typewriter face under Editorial, nothing at all under Original), and
`useNameTitleStyle()` is a bar title's style, the stack's own 17 pt title with
only the face changed. `tests/editorial-names.test.ts` lists every place a
username is drawn, so none is dropped and none is added without it.

## Where it lives

The experiment is only on the branch `claude/editorial-feed-preview`, which is
`claude/product-polish` plus these files:

| file | what it is |
|------|------------|
| `src/components/feed/EditorialPostCard.tsx` | the editorial card (new), its usernames in the typewriter face |
| `src/utils/feedLayout.ts` | the layout preference, kept on the phone (new) |
| `src/utils/feedPaper.ts` | the paper preference, kept on the phone, and the paper a feed lies on (new) |
| `src/utils/nameFace.ts` | the usernames' face while Editorial is chosen (new) |
| `tests/editorial-feed.test.ts` | its guards (new) |
| `tests/editorial-names.test.ts` | the usernames' guards: every place one is drawn, and who reads the face (new) |
| `EDITORIAL_FEED_PREVIEW.md` | this page (new) |
| `app/(tabs)/index.tsx` | Home's seam: which card it draws, and the paper under it |
| `app/gallery.tsx` | the gallery's seam: which card it draws, the paper under it and its bar's, and its bar's title in the names' face when it is the author's username |
| `app/(tabs)/_layout.tsx` | Home's wordmark bar and tab bar on the paper, and the Profile tab's title, its username, in the names' face |
| `app/settings.tsx` | the Feed layout and Paper choices |
| `app/(tabs)/activity.tsx`, `app/comments.tsx`, `app/compose.tsx`, `app/post/[id].tsx`, `app/user/[username].tsx`, `app/messages/index.tsx`, `app/messages/[id].tsx`, `app/share.tsx`, `app/requests.tsx`, `app/blocked.tsx`, `app/admin/applications.tsx`, `app/admin/reports.tsx` | the usernames each screen draws, and the bar's title where it is one, in the names' face |
| `src/components/UserRow.tsx`, `src/components/TagPicker.tsx`, `src/components/PendingPostCard.tsx`, `src/components/ProfileHeader.tsx` | the same, in the parts those screens share (the profile header only where its name falls back to the username) |
| `tests/video-playback.test.ts` | the Home and gallery playback guards accept either card |
| `tests/galleryLanding.test.ts` | its gallery guard reads whichever card the gallery's seam draws |
| `e2e/launch-test.mjs` | the walk switches it on and off, reads a print, tries both papers, opens a gallery, and reads the usernames' face on Home, in the comments, in Activity and in a profile's and a gallery's title |

`src/components/PostCard.tsx` (drawn only under Original, so its names are
left as they are), `PostMedia`, `usePostActions`, uploads, filters, the Memory
Room, native modules and Supabase are not touched. `PendingPostCard` is
touched for the names' face alone.

## Keeping it out

Build or merge `claude/product-polish` instead of this branch. It has every
permanent change and none of the experiment.

## Taking it out of a branch that has it

From the repository root, on the branch to clean:

```bash
git rm src/components/feed/EditorialPostCard.tsx src/utils/feedLayout.ts src/utils/feedPaper.ts src/utils/nameFace.ts tests/editorial-feed.test.ts tests/editorial-names.test.ts EDITORIAL_FEED_PREVIEW.md
git checkout claude/product-polish -- "app/(tabs)/index.tsx" app/gallery.tsx "app/(tabs)/_layout.tsx" app/settings.tsx "app/(tabs)/activity.tsx" app/comments.tsx app/compose.tsx "app/post/[id].tsx" "app/user/[username].tsx" app/messages/index.tsx "app/messages/[id].tsx" app/share.tsx app/requests.tsx app/blocked.tsx app/admin/applications.tsx app/admin/reports.tsx src/components/UserRow.tsx src/components/TagPicker.tsx src/components/PendingPostCard.tsx src/components/ProfileHeader.tsx tests/video-playback.test.ts tests/galleryLanding.test.ts e2e/launch-test.mjs
npx tsc --noEmit && npx vitest run
git commit -m "Remove the Editorial feed preview"
```

The `checkout` line is right when the branch has every change
`claude/product-polish` has made to those files (as it does just after
merging it) and no change of its own to them besides the experiment's. If
not, take the experiment's hunks out of them by hand instead
(`git diff claude/product-polish claude/editorial-feed-preview -- <file>`
shows exactly what to remove). In `app/gallery.tsx` those are the four
imports (`EditorialPostCard`, `useFeedLayout`, `useFeedBackground`,
`useNameTitleStyle`), the `FeedCard`, `paper` and `titleStyle` lines with the
comments above them, `style={paper}` on the `Screen`,
`headerStyle: paper …` and `headerTitleStyle: titleStyle` in the
`Stack.Screen` options, and `<FeedCard`, which goes back to `<PostCard`. In
every other file the names' face touches, they are the import from
`@/utils/nameFace`, the `const face = useNameFace();` or
`const titleStyle = useNameTitleStyle();` line with the comment above it, and
each place it is used: `[style, face]` goes back to `style`,
`, headerTitleStyle: titleStyle` comes out of a `Stack.Screen`'s options, a
`<Text style={face}>` around a username goes back to the bare username (in
`app/admin/reports.tsx` to `{item.reporter?.username ?? "unknown"}`, in
`app/(tabs)/activity.tsx` to `{item.actor.username} ` inside the bold `Text`,
and in `app/user/[username].tsx` the two sentences go back to their template
strings). Afterwards `git diff claude/product-polish -- app src tests e2e`
should be empty, and
`git grep -n -e EditorialPostCard -e feedLayout -e feedPaper -e useFeedBackground -e nameFace -e NameFace -e NameTitle -- app src tests e2e`
should find nothing.

## On phones that tried it

Once the code is gone nothing reads `feed-layout.json` or `feed-paper.json`,
and everyone sees the original feed on the app's paper. The files are a few
bytes each and can be left.
