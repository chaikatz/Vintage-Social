# Editorial feed (preview)

A second way to set out a feed's posts, for trying on a phone before
deciding whether to keep it. It is off by default: Settings › Appearance ›
Feed layout offers **Original** (the feed as it has always been, and the
default) and **Editorial** (called "Editorial (Preview)" until 9 November;
the word was taken off what members and App Review see, since Apple turns
away apps that look like a trial). While Editorial is chosen, a second
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
black.

A post still on its way up lies on the same paper: its card at the top of
Home (`PendingPostCard`) has no paper of its own, a permanent change that
is on `claude/product-polish` too.

## Usernames

While Editorial is chosen, every username the app draws, on every page, is
set in Cormorant Garamond Medium Italic, the face the owner chose for the
names on the editorial card (24 November), in the place's own colour. Its
small letters are short, so a name set at the size of the words around it
would look a size smaller than them: a name is set at the size of the words
it sits beside (or, where it stands alone, of the words it stands in for)
times 16 / 12.5, the card's 16 pt names over its 12.5 pt words, to the half
point. A name in a 14 pt comment is 18 pt, in a 15 pt row of a list 19 pt,
in a 13 pt notice 16.5 pt, and before a post's 15 pt serif caption 19 pt.

That holds everywhere a name is drawn: the member's name over each print
and before its caption and comments; the notices in Activity; the Comments
screen; a post's own page (its author, the name before its caption, its
comments and the members tagged in it); every @name in what a member wrote,
a caption or a comment, still in the accent a link is drawn in; the card of
a post on its way up; every list of members (Search and its recent
searches, Followers and Following, Likes, the admin's Members); Requests;
Blocked members; Tag people (its chips and its list); the members offered
while an @name is written; who was there in New post; Send to (the
photograph's author and the members to send it to); the inbox; the author
of a photograph sent in a message; the admin's Applications and Reports; a
profile's name where it falls back to the username; the lines the app
writes around a username (a blocked or private profile's, an empty
Followers or Following list's, an empty Eras page's); and every bar titled
with a username (below).

Where a place marks a name for a state of its own, the state still wins:
an unread thread's name in the inbox, semibold under Original, is drawn in
the face's heavier cut, Cormorant Garamond SemiBold Italic, a step above a
read one's medium; the author of a photograph sent in your own dark bubble
keeps the bubble's light ink; and a member tagged who has not yet accepted
stays faint, with "(pending)" after the name. Under Original nothing
changes.

A bar titled with a username (a member's profile opened from anywhere, the
gallery of their photographs, a message thread, and the Profile tab, which
the app draws itself) is set in the face at 22 pt, the size that matches
the 17 pt serif the bars' titles are set in, its weight over the stack's
bold. The Profile tab's bar keeps its height: the face's line is taller
than the serif's, and the title gives the difference back to the bar's
padding above and below. Every other bar's title (Settings, Messages, an
era's gallery and the rest) is the stack's own under both layouts.

Display names, what a member types into a field, and what members wrote
(captions, comments, messages) are as they were, but for the @names in
them. A system alert titled with a username is drawn by iOS in its own face
and cannot be styled, and what VoiceOver says is never drawn. A photograph
exported as a print keeps the `@name` on its label in the print's
typewriter face, under either layout: it is the print's own lettering.

`src/utils/nameFace.ts` holds it. `useNameFace()` is a function of the size
of the words a name sits beside, and of the cut a state asks for
(`face(15)`, `face(15, unread ? "semibold" : "medium")`): under Editorial
it is the face, `{ fontFamily, fontSize, fontWeight }`, and under Original
nothing at all. It is laid last over a name's own style, after the place's
and any state's, so its family, size and weight are the name's and the
place's colour stays. The weight is the one that lands on the cut: on the
iPhone the cut's own (500, 600), since React Native draws the cut of the
family nearest the weight asked for, so a place's own semibold under it
does not pick the heavier cut; on the web regular, since there each cut is
a family of its own, registered at the regular weight, and a heavier one
would be faked. `nameStyle(size, cut)` is the face itself, which the
editorial card sets in its sheet. `useNameTitleStyle()` is the title style
of a bar titled with a username: the stack's own
(`{ fontFamily: type.serif, fontSize: 17 }`, as `app/_layout.tsx` sets it)
under Original, and the face at 22 pt under Editorial. It is handed to the
bar under Original too, because a screen's options are merged into the ones
it set before: a title left without one would keep Editorial's face after
Settings turns Editorial off. In `src/components/MemberText.tsx`,
`MentionText` is handed the size of the words it is drawn in and sets each
@name in the face, and `NamedWords` draws words the app writes a username
into, with the name in the face under Editorial and the one string the
words always were under Original; `EmptyState` hands it its body and the
username, when the screen gives it one.
Both cuts are built into the iPhone app by expo-font's plugin in `app.json`
and loaded once on the web by `nameFace.ts`. `tests/editorial-names.test.ts`
lists every place a username is drawn, each at its size, every bar titled
with one and every sentence the app writes one into, so none is dropped and
none is added without it.

## Where it lives

The experiment is only on the branch `claude/editorial-feed-preview`, which is
`claude/product-polish` plus these files:

| file | what it is |
|------|------------|
| `src/components/feed/EditorialPostCard.tsx` | the editorial card (new): its usernames in Cormorant Garamond Medium Italic, 16 pt, in the name ink, the member's picture in a thin ring, the words at 12.5 pt (the owner's restyle, 24 November, a size up the same day) |
| `src/utils/feedLayout.ts` | the layout preference, kept on the phone (new) |
| `src/utils/feedPaper.ts` | the paper preference, kept on the phone, and the paper a feed lies on (new) |
| `src/utils/nameFace.ts` | the usernames' face while Editorial is chosen: Cormorant Garamond at the size that matches the words beside it, its semibold where a state marks a name heavier, the title style of a bar titled with a username, and both cuts loaded on the web (new) |
| `tests/editorial-feed.test.ts` | its guards (new) |
| `tests/editorial-names.test.ts` | the usernames' guards: every place one is drawn, each at its size, every bar titled with one, every sentence one is written into, the states that still win, and who reads the module (new) |
| `EDITORIAL_FEED_PREVIEW.md` | this page (new) |
| `app/(tabs)/index.tsx` | Home's seam: which card it draws, and the paper under it |
| `app/gallery.tsx` | the gallery's seam: which card it draws, and the paper under it and its bar's; and its title, when it is the author's username, in the names' face |
| `app/user/[username].tsx` | a member's profile: its title, their username, in the names' face, and the lines a blocked or private profile writes around it drawn by `NamedWords` |
| `app/(tabs)/_layout.tsx` | Home's wordmark bar and tab bar on the paper; the Profile tab's title, the member's username, in the names' face, the bar its height |
| `app/settings.tsx` | the Feed layout and Paper choices |
| `app/(tabs)/activity.tsx`, `app/comments.tsx`, `app/compose.tsx`, `app/post/[id].tsx`, `app/messages/index.tsx`, `app/messages/[id].tsx`, `app/share.tsx`, `app/requests.tsx`, `app/blocked.tsx`, `app/admin/applications.tsx`, `app/admin/reports.tsx` | the usernames each screen draws, in the names' face at the size of the words beside them (in `app/messages/index.tsx`, after an unread thread's style, which picks the semibold cut; in `app/messages/[id].tsx`, on the name alone, inside the line that keeps your own bubble's ink, and the thread's title too; in `app/post/[id].tsx`, after a pending tag's style, and the name before the caption too) |
| `src/components/UserRow.tsx`, `src/components/TagPicker.tsx`, `src/components/MentionSuggestions.tsx`, `src/components/PendingPostCard.tsx`, `src/components/ProfileHeader.tsx` | the same, in the parts those screens share (the profile header only where its name falls back to the username) |
| `src/components/MemberText.tsx` | `MentionText` is handed the size of the words it is drawn in, and sets each @name in the names' face, still in the accent; `NamedWords` (new) sets a username the app writes words around in the names' face, and under Original is the words' one string |
| `src/components/EmptyState.tsx`, `app/follows.tsx`, `src/components/EraList.tsx` | an empty page's sentence: `EmptyState` hands its body and the username to `NamedWords`, and an empty Followers or Following list and an empty Eras page hand it the one their sentence is written around |
| `tests/video-playback.test.ts` | the Home and gallery playback guards accept either card |
| `tests/galleryLanding.test.ts` | its gallery guard reads whichever card the gallery's seam draws |
| `tests/stableCards.test.ts` | its Home and gallery card-props guard accepts either card |
| `tests/thread-menu.test.ts` | its guard on the thread's title link accepts the title style as well as the stack's |
| `tests/comment-menu.test.ts` | its Home and gallery guard on a comment's menu accepts either card |
| `tests/member-names.test.ts` | its guards on the names that are links accept the names' face, at a size, in a link's style, and the size `MentionText` is handed |
| `tests/admin-queue-pages.test.ts` | its guard on a report's names accepts the names' face in the link's style |
| `src/theme/index.ts` | one colour, `nameInk` (#2A2826 on paper, white on black), for the editorial card's names and ring |
| `tests/theme.test.ts` | lists `nameInk` among the tokens on paper |
| `assets/fonts/CormorantGaramond-MediumItalic.ttf`, `assets/fonts/CormorantGaramond-SemiBoldItalic.ttf`, `assets/fonts/CormorantGaramond-OFL.txt` | the names' face, weight 500 italic, its heavier cut, weight 600 italic, and their SIL Open Font License (new) |
| `app.json` | expo-font's plugin builds both cuts into the iPhone app (`fonts`) |
| `tests/editorial-name-font.test.ts` | the face's guards: each cut is asked for by its file's own PostScript name, at its own weight, the plugin builds both in, the web loads both, the licence travels with them (new) |
| `e2e/launch-test.mjs` | the walk switches it on and off, reads a print, tries both papers, opens a gallery, and reads the usernames' face, size and colour on Home, in the comments, in Activity and in the inbox (an unread thread's name in the semibold cut, a read one's in the medium), each at the size that matches the words beside it, and a profile's and a gallery's title (the face at 22 pt, beside a bar titled with other words), and that Original sets the names and those titles back exactly as they were |

`src/components/PostCard.tsx` (drawn only under Original, so its names are
left as they are), `src/components/eraBook.ts` (the words of an empty Eras
page, which `EraList` hands to `EmptyState` with the username), every other
bar's title, `PostMedia`, `usePostActions`, uploads, filters, the Memory
Room, native modules and Supabase are not touched. `PendingPostCard` is
touched for the names alone.

## Keeping it out

Build or merge `claude/product-polish` instead of this branch. It has every
permanent change and none of the experiment.

## Taking it out of a branch that has it

From the repository root, on the branch to clean:

```bash
git rm src/components/feed/EditorialPostCard.tsx src/utils/feedLayout.ts src/utils/feedPaper.ts src/utils/nameFace.ts tests/editorial-feed.test.ts tests/editorial-names.test.ts tests/editorial-name-font.test.ts assets/fonts/CormorantGaramond-MediumItalic.ttf assets/fonts/CormorantGaramond-SemiBoldItalic.ttf assets/fonts/CormorantGaramond-OFL.txt EDITORIAL_FEED_PREVIEW.md
git checkout claude/product-polish -- "app/(tabs)/index.tsx" app/gallery.tsx "app/(tabs)/_layout.tsx" app/settings.tsx "app/(tabs)/activity.tsx" app/comments.tsx app/compose.tsx "app/post/[id].tsx" app/messages/index.tsx "app/messages/[id].tsx" app/share.tsx app/requests.tsx app/blocked.tsx app/admin/applications.tsx app/admin/reports.tsx "app/user/[username].tsx" app/follows.tsx src/components/UserRow.tsx src/components/TagPicker.tsx src/components/MentionSuggestions.tsx src/components/PendingPostCard.tsx src/components/ProfileHeader.tsx src/components/MemberText.tsx src/components/EmptyState.tsx src/components/EraList.tsx src/theme/index.ts tests/theme.test.ts app.json tests/video-playback.test.ts tests/galleryLanding.test.ts tests/stableCards.test.ts tests/comment-menu.test.ts tests/thread-menu.test.ts tests/member-names.test.ts tests/admin-queue-pages.test.ts e2e/launch-test.mjs
npx tsc --noEmit && npx vitest run
git commit -m "Remove the Editorial feed preview"
```

The `checkout` line is right when the branch has every change
`claude/product-polish` has made to those files (as it does just after
merging it) and no change of its own to them besides the experiment's. If
not, take the experiment's hunks out of them by hand instead
(`git diff claude/product-polish claude/editorial-feed-preview -- <file>`
shows exactly what to remove). In `app/gallery.tsx` those are the three
imports (`EditorialPostCard`, `useFeedLayout`, `useFeedBackground`), the
`FeedCard` and `paper` lines with the comment above them, `style={paper}` on
the `Screen`, `headerStyle: paper …` in the `Stack.Screen` options, and
`<FeedCard`, which goes back to `<PostCard`; and, as in `app/messages/[id].tsx`
and `app/user/[username].tsx`, the import from `@/utils/nameFace`, the
`const titleStyle = useNameTitleStyle(…);` line with the comment above it,
and `, headerTitleStyle: titleStyle` in each `Stack.Screen`'s options (in
`app/messages/[id].tsx` the `headerTitleStyle: titleStyle,` line, and the
title link's `[titleStyle, { maxWidth: … }]`, which goes back to
`[styles.title, { maxWidth: … }]`). In
every file the names' face touches, they are the import from
`@/utils/nameFace` (`useNameFace`), the `const face = useNameFace();` line
with the comment above it, and each place it is used: `[style, face(n)]`
goes back to `style` (in `app/messages/index.tsx`,
`[styles.username, unread && styles.unreadText, face(15, unread ? "semibold" : "medium")]`
and in `app/post/[id].tsx`,
`[styles.withName, t.status === "pending" && styles.withPending, face(12)]`
lose only the face; in `app/messages/[id].tsx` the link to a photograph's
author loses its `style={face(11)}`; in `src/components/ProfileHeader.tsx`
the array with its `? face(15) : undefined` goes back to the plain style;
in `app/admin/reports.tsx` `nameOf`'s link goes back to
`style={styles.name}`), and each `size={…}` handed to `MentionText`. In
`src/components/MemberText.tsx`, `MentionText`'s `size` prop, its
`const face` and the face in an @name's style go, and so do `NamedWords`
and `nameAt`; in `app/user/[username].tsx` each `<NamedWords words={…} …/>`
goes back to the words it is handed (`You blocked {profile.username}`, and
the two sentences as strings) and its import goes; in
`src/components/EmptyState.tsx` the `name` prop and `NamedWords` go, and
`app/follows.tsx` and `src/components/EraList.tsx` hand it no `name`; in `app/(tabs)/_layout.tsx` the Profile tab's title loses
`titleStyle` and `nameTitle` (and `styles.nameTitle` goes). Afterwards
`git diff claude/product-polish -- app src tests e2e`
should be empty, and
`git grep -n -e EditorialPostCard -e feedLayout -e feedPaper -e useFeedBackground -e nameFace -e NameFace -- app src tests e2e`
should find nothing.

## On phones that tried it

Once the code is gone nothing reads `feed-layout.json` or `feed-paper.json`,
and everyone sees the original feed on the app's paper. The files are a few
bytes each and can be left.
