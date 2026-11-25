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
printed, the like, comment and send buttons. There is no count of
comments, no `@name` on the label, no wordmark, no "Members only" and no
membership number. Then, under your own photograph only, how many liked
it (`4 likes`, which opens who did, or `No likes yet`, quieter, in its
place at the same height); under anyone else's, nothing, as on the
original card (the owner's request of 25 November; the rule is
`src/utils/ownLikes.ts`, on `claude/product-polish`). Then the caption
after the member's name, the way a comment is written, the newest
comments, and last, in the label's typewriter face, when it was posted
(`29m ago`).

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

## A post on its way up

While Editorial is chosen, a post still going up is drawn at the top of
Home as the editorial card it is about to become
(`src/components/feed/EditorialPendingCard.tsx`, the owner's request of 25
November: on build 58 it was drawn full width in the original style, and
the print that took its place looked like something else). It is made of
the editorial card's own pieces, on its own sheet: the member over the
print (`PrintMember`), the picture inside the print's margins at its own
shape, the hairline, the label with the place and the date in full
(`PrintLabel`), and the caption after the member's name (`PrintCaption`).
So when the post is up and the feed's row takes its place, nothing moves:
the web walk measures the card's top, the picture's box and the card's
height the same to the hundredth of a point at 390 and at 320 points.

What is not yet so is left as paper, or says so. There is no "…", and no
like, comment or send button: their room on the label is left as paper
(`NoButtonsYet`, as wide and as tall as the three of them), so the place
and the date stand where they will. The hairline under the picture fills
with the accent as the post goes up, and stays where it got to, faint,
while it waits or has failed. The line under the label, where your own
post's `No likes yet` will be, says what is happening (`Uploading…`,
`Waiting for a connection`, `Couldn't post.`) in the label's typewriter
face, with Retry and Discard, at that line's height; why it failed goes
under it. With Larger Text its words grow as far as the label's and the
count's do (`LABEL_CAP`, through `PendingStatus`'s `cap`), so it keeps the
count's height at every size. The last line, where the post will say when it went up, says who
was there (`With one member`), or is left as paper. Nothing on it can be
liked, commented on or sent, and nothing reads as posted until the server
has it.

What it says and does is the original pending card's: both draw from
`usePendingCard`, `PendingStatus` and `ProgressRule` in
`src/components/PendingPostCard.tsx`, so the words, Retry, Discard behind
the same question, the hold while it is asked, and what VoiceOver hears
are the same. Under Original the card is drawn exactly as before. Home
draws the one that follows the card chosen
(`const PendingCard = FeedCard === EditorialPostCard ? EditorialPendingCard : PendingPostCard;`).

## Usernames

While Editorial is chosen, every username the app draws, on every page, is
set in Cormorant Garamond Bold Italic, the face the owner chose for the
names on the editorial card (24 November; in its bold, at the same sizes,
once the owner had seen build 56), in the place's own colour. Its small
letters are short, so a name set at the size of the words around it
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
Followers or Following list's, an empty Eras page's), and who sent an
applicant (in the admin's Applications) or an invitation (on the
invitation's page), where that reads as a username; and every bar titled
with a username (below).

Every name is in the one cut. An unread thread's name in the inbox,
semibold under Original, is in it too, as a read one's is: the thread is
still told by its dot and its darker, heavier preview. Where a place marks
a name for a state of its own, the state still wins: the author of a
photograph sent in your own dark bubble keeps the bubble's light ink, and a
member tagged who has not yet accepted stays faint, with "(pending)" after
the name. Under Original nothing changes.

The italic leans out of its letters' widths: the f's and the j's tails
reach in under the letter before (0.128 and 0.114 of the size), the f's
hook out over the one after (0.149), and the p, y, g and the 3, 5, 7 and 9
a little. On the iPhone a Text draws nothing outside its own box, which is
as wide as its letters' widths and starts at its first letter, so a name
that begins or ends a Text would lose those tails at its edge (a web walk
cannot show this: a browser does not cut a span's ink to its box). So,
under Editorial only:

- A name that is all its Text holds (a row in a list, the inbox, a chip,
  a header, the editorial card's name over the print, the Profile tab's
  title) has its box grown by the room on each side, as padding, and given
  back as a negative margin, so the letters, and everything around them,
  stay exactly where they were: the farthest any letter reaches at the
  name's size, to the whole point above (3 pt for the names of lists and
  the card, 4 pt for the 22 pt titles). New post's line of tagged members
  keeps its own 4 pt before the names (its margin on that side outranks
  the room's on both, so it is set less the room), and the members offered
  for an @name keep their widest, 160 pt, inside the room.
- A name that begins a line of words (a caption's, a comment's or a
  notice's author, the photograph's author under it in a message, a
  reported comment's author, a sentence the app writes that starts with
  the name) cannot be given room by its box: a line that holds a link to a
  member is never padded (`tests/name-link-hit-area.test.ts`). So where
  its first letter reaches out, a no-break narrow space (U+202F), in the
  face, sized to be exactly as wide as the letter reaches, is laid before
  it, beside its link and never in it: the name moves over by that (1.8 pt
  for a 16 pt j) and no more, and most names, whose first letter does not
  reach out, do not move at all. The same after a name that ends a
  sentence the app writes, and after the photograph's author in a message,
  for a last letter that reaches out. A name in the middle of a line has a
  word space beside it and needs nothing; a name that a line wraps to the
  start of a later line is not given room.
- A bar titled with a username (a member's profile, their gallery, a
  message thread) is drawn by the app under Editorial, as the stack draws
  a title of its own (`NameTitle`, in `src/components/NameTitle.tsx`,
  `HeaderTitle` with the room), since the bar's own label draws only within
  its letters' widths. It is the same size, centred by the bar as its own
  title is, and as wide at most as the thread's title always was (the
  screen less 150 pt, never under 120 pt), the room beyond that. On the
  iPhone it keeps the room inside what the bar holds (no negative margin):
  the bar holds the title in a view as wide as the title's margins make it
  (react-native-screens' header subview), and when the screen is popped it
  fades a picture of that view, which shows only what lies inside it; the
  bar centres the view, so the letters stay where they were. On the web,
  where the bar sets its title at its start, the negative margin keeps them
  there. Under Original the bar draws its own title exactly as before (the
  thread's, a link, was always the app's own and still is).

A bar titled with a username (a member's profile opened from anywhere, the
gallery of their photographs, a message thread, and the Profile tab, which
the app draws itself) is set in the face at 22 pt, the size that matches
the 17 pt serif the bars' titles are set in, its weight over the stack's
bold, with the room above. The Profile tab's bar keeps its height: the face's line is taller
than the serif's, and the title gives the difference back to the bar's
padding above and below, scaled with the reader's text size as both lines
are, so it holds under Larger Text too. Every other bar's title (Settings, Messages, an
era's gallery and the rest) is the stack's own under both layouts.

Display names, what a member types into a field, and what members wrote
(captions, comments, messages) are as they were, but for the @names in
them. Who sent an applicant is what they typed, and the invitation's page
names the member by their full name where they gave one: either is set in
the face only where it reads as a username (`USERNAME_RE`, which every
member's username is held to). A system alert titled with a username is
drawn by iOS in its own face and cannot be styled, and what VoiceOver says
is never drawn. A photograph exported as a print keeps the `@name` on its
label in the print's typewriter face, under either layout: it is the
print's own lettering, captured into the picture members share outside the
app, and the one place a username is not in the face; whether the print
should follow the Settings choice too is the owner's call.

`src/utils/nameFace.ts` holds it. `useNameFace()` is a function of the size
of the words a name sits beside, and of whether the name is all its Text
holds (`face(15)`, `face(15, "alone")`): under Editorial it is the face,
`{ fontFamily, fontSize, fontWeight }`, with the room
(`paddingHorizontal`, and `marginHorizontal` its negative) for a name
alone, and under Original nothing at all. It is laid last over a name's
own style, after the place's and any state's, so its family, size and
weight are the name's and the place's colour stays. The weight is the one
that lands on the cut: on the iPhone its own, 700. There the PostScript
name finds the cut (React Native's new architecture,
`RCTFontWithFontProperties` in `RCTFontUtils.mm`, knows no family by that
name, so it opens the font of that name, and then looks through its family
only among cuts as italic as the style asks for; no style is set, the
family's one cut is italic, so the named cut stays), and the weight would
matter only if a style ever asked for italic, when the cut nearest 700 is
this one too: the bold italic itself, never a bold faked over it; on the web regular, since there the
cut is a family of its own, registered at the regular weight, and a
heavier one would be faked. `nameStyle(size, alone)` is the face itself,
which the editorial card sets in its sheet. `nameRoom(size)` is the room
in points, and `nameEdge(size, name, side)` what the narrow space
(`NAME_EDGE`) before or after a name in a line is drawn in, or nothing;
the figures they follow are read from the font file by
`tests/editorial-name-room.test.ts`. `useNameTitleStyle()` is the title
style of a bar titled with a username: the stack's own
(`{ fontFamily: type.serif, fontSize: 17 }`, as `app/_layout.tsx` sets it)
under Original, and the face at 22 pt, with its room, under Editorial. It
is handed to the bar under Original too, because a screen's options are
merged into the ones it set before: a title left without one would keep
Editorial's face after Settings turns Editorial off. In `src/components/MemberText.tsx`,
`MentionText` is handed the size of the words it is drawn in and sets each
@name in the face, `NameEdge` draws the narrow space before a name that
begins a line (or after one, `side="right"`), and `NamedWords` draws words
the app writes a username into, with the name in the face under Editorial
and the one string the words always were under Original. It is handed what writes the words, a
function of the name (`(name) => `You blocked ${name}``), never the words
already written, so the name is found where the sentence puts it and never
in one of the app's own words a username happens to spell ("You blocked
blocked"); `EmptyState` is handed its body that way too, with the username,
when the screen gives it one.
In `src/components/NameTitle.tsx`, `NameTitle` draws a bar's title that
is a username, and `nameHeaderTitle(titleStyle)` is what a screen hands
its bar as `headerTitle`: `NameTitle` under Editorial, nothing under
Original (handed over under both, as the title style is). The cut is
built into the iPhone app by expo-font's plugin in `app.json` and loaded
once on the web by `nameFace.ts`. `tests/editorial-names.test.ts`
lists every place a username is drawn, each at its size, every bar titled
with one and every sentence the app writes one into, so none is dropped and
none is added without it.

## Where it lives

The experiment is only on the branch `claude/editorial-feed-preview`, which is
`claude/product-polish` plus these files:

| file | what it is |
|------|------------|
| `src/components/feed/EditorialPostCard.tsx` | the editorial card (new): its usernames in Cormorant Garamond Bold Italic, 16 pt, in the name ink (the one over the print with its room, those before the words with the narrow space before a first letter that reaches out), the member's picture in a thin ring, the words at 12.5 pt (the owner's restyle, 24 November, a size up the same day, in the bold once the owner had seen build 56); under your own photograph its count of likes, or `No likes yet`, through `likesLine` (25 November); its member, label and caption as pieces of their own (`PrintMember`, `PrintLabel`, `PrintCaption`, `NoButtonsYet`) and its sheet (`printStyles`), which the card of a post on its way up draws too |
| `src/components/feed/EditorialPendingCard.tsx` | a post on its way up, drawn as the editorial card it will become, from that card's pieces (new) |
| `src/utils/feedLayout.ts` | the layout preference, kept on the phone (new) |
| `src/utils/feedPaper.ts` | the paper preference, kept on the phone, and the paper a feed lies on (new) |
| `src/utils/nameFace.ts` | the usernames' face while Editorial is chosen: Cormorant Garamond Bold Italic at the size that matches the words beside it, the room around a name alone and before or after one in a line, the title style of a bar titled with a username, and the cut loaded on the web (new) |
| `src/components/NameTitle.tsx` | a bar's title that is a username, drawn by the app under Editorial so its letters have room, and what a screen hands its bar to draw it (new) |
| `tests/editorial-feed.test.ts` | its guards (new) |
| `tests/editorial-names.test.ts` | the usernames' guards: every place one is drawn, each at its size, every bar titled with one, every sentence one is written into, the states that still win, and who reads the module (new) |
| `tests/editorial-name-room.test.ts` | the room's guards: how far each letter reaches, read from the font file, the room it is given, every name alone and every name that begins a line given it, and the bars' titles drawn with it (new) |
| `EDITORIAL_FEED_PREVIEW.md` | this page (new) |
| `app/(tabs)/index.tsx` | Home's seam: which card it draws, and the paper under it |
| `app/gallery.tsx` | the gallery's seam: which card it draws, and the paper under it and its bar's; and its title, when it is the author's username, in the names' face, drawn by `NameTitle` |
| `app/user/[username].tsx` | a member's profile: its title, their username, in the names' face, drawn by `NameTitle`, and the lines a blocked or private profile writes around it drawn by `NamedWords` |
| `app/(gate)/invite.tsx` | the invitation's page: the line naming who sent it drawn by `NamedWords`, so a username there is in the names' face |
| `app/(tabs)/_layout.tsx` | Home's wordmark bar and tab bar on the paper; the Profile tab's title, the member's username, in the names' face, the bar its height at every size of text |
| `app/settings.tsx` | the Feed layout and Paper choices |
| `app/(tabs)/activity.tsx`, `app/comments.tsx`, `app/compose.tsx`, `app/post/[id].tsx`, `app/messages/index.tsx`, `app/messages/[id].tsx`, `app/share.tsx`, `app/requests.tsx`, `app/blocked.tsx`, `app/admin/applications.tsx`, `app/admin/reports.tsx` | the usernames each screen draws, in the names' face at the size of the words beside them, with the room around a name alone (`face(n, "alone")`) and a `NameEdge` before one that begins a line (in `app/messages/index.tsx`, after an unread thread's style, in the one cut; in `app/messages/[id].tsx`, on the name alone, inside the line that keeps your own bubble's ink, and the thread's title too, drawn by `NameTitle`; in `app/post/[id].tsx`, after a pending tag's style, and the name before the caption too; in `app/compose.tsx`, the line's own margin less the room, `tagNamesAlone`; in `app/admin/applications.tsx`, who sent an applicant too, drawn by `NamedWords`) |
| `src/components/UserRow.tsx`, `src/components/TagPicker.tsx`, `src/components/MentionSuggestions.tsx`, `src/components/PendingPostCard.tsx`, `src/components/ProfileHeader.tsx` | the same, in the parts those screens share (the profile header only where its name falls back to the username; in `MentionSuggestions`, its widest more the room, `usernameAlone`) |
| `src/components/MemberText.tsx` | `MentionText` is handed the size of the words it is drawn in, and sets each @name in the names' face, still in the accent; `NamedWords` (new), handed what writes its words around a name, sets the name in the names' face where it reads as a username, with the narrow space before or after it where the words begin or end with it, and under Original is the words' one string; `NameEdge` (new), the narrow space before a name that begins a line |
| `src/components/EmptyState.tsx`, `app/follows.tsx`, `src/components/EraList.tsx` | an empty page's sentence: `EmptyState` takes a body that writes its words around a name, with the name, and hands both to `NamedWords`; an empty Followers or Following list and an empty Eras page hand it theirs (the Eras page's is `erasEmpty`'s own sentence, written around the name) |
| `tests/video-playback.test.ts` | the Home and gallery playback guards accept either card |
| `tests/likes-own-0042.test.ts` | its guards on the cards told who is reading accept the card the layout chose (`FeedCard`), and it allows the editorial card to read `like_count` through `likesLine` |
| `tests/outbox.test.ts` | its guard on Home's pending card accepts the one the layout chose (`PendingCard`) |
| `tests/galleryLanding.test.ts` | its gallery guard reads whichever card the gallery's seam draws |
| `tests/stableCards.test.ts` | its Home and gallery card-props guard accepts either card |
| `tests/thread-menu.test.ts` | its guard on the thread's title link accepts the title style, drawn by `NameTitle`, as well as the stack's |
| `tests/comment-menu.test.ts` | its Home and gallery guard on a comment's menu accepts either card |
| `tests/member-names.test.ts` | its guards on the names that are links accept the names' face, at a size, in a link's style, and the size `MentionText` is handed |
| `tests/admin-queue-pages.test.ts` | its guard on a report's names accepts the names' face in the link's style, and the narrow space before a reported comment's author |
| `src/theme/index.ts` | one colour, `nameInk` (#2A2826 on paper, white on black), for the editorial card's names and ring |
| `tests/theme.test.ts` | lists `nameInk` among the tokens on paper |
| `assets/fonts/CormorantGaramond-BoldItalic.ttf`, `assets/fonts/CormorantGaramond-OFL.txt` | the names' face, weight 700 italic, and its SIL Open Font License (new) |
| `app.json` | expo-font's plugin builds the cut into the iPhone app (`fonts`) |
| `tests/editorial-name-font.test.ts` | the face's guards: the cut is asked for by its file's own PostScript name, at its own weight, bold and italic in itself, the plugin builds it in, the web loads it, the licence travels with it (new) |
| `e2e/launch-test.mjs` | the walk switches it on and off, reads a print, tries both papers, opens a gallery, and reads the usernames' face, size and colour on Home, in the comments, in Activity and in the inbox (read or not, in the one cut), each at the size that matches the words beside it, and a profile's and a gallery's title (the face at 22 pt, beside a bar titled with other words), and that Original sets the names and those titles back exactly as they were |

`src/components/PostCard.tsx` (drawn only under Original, so its names are
left as they are), `src/components/eraBook.ts` (the words of an empty Eras
page, which `EraList` hands to `EmptyState` written around the username), every other
bar's title, `PostMedia`, `usePostActions`, uploads, filters, the Memory
Room, native modules and Supabase are not touched. `PendingPostCard` is
touched for the names, and so that what it says and does is drawn from one
place by both cards (`usePendingCard`, `PendingStatus`, `ProgressRule`,
each the original card's own code, moved out of its body); it is drawn
exactly as before.

## Keeping it out

Build or merge `claude/product-polish` instead of this branch. It has every
permanent change and none of the experiment.

## Taking it out of a branch that has it

From the repository root, on the branch to clean:

```bash
git rm src/components/feed/EditorialPostCard.tsx src/components/feed/EditorialPendingCard.tsx src/utils/feedLayout.ts src/utils/feedPaper.ts src/utils/nameFace.ts src/components/NameTitle.tsx tests/editorial-feed.test.ts tests/editorial-names.test.ts tests/editorial-name-font.test.ts tests/editorial-name-room.test.ts assets/fonts/CormorantGaramond-BoldItalic.ttf assets/fonts/CormorantGaramond-OFL.txt EDITORIAL_FEED_PREVIEW.md
git checkout claude/product-polish -- "app/(tabs)/index.tsx" app/gallery.tsx "app/(tabs)/_layout.tsx" app/settings.tsx "app/(tabs)/activity.tsx" app/comments.tsx app/compose.tsx "app/post/[id].tsx" app/messages/index.tsx "app/messages/[id].tsx" app/share.tsx app/requests.tsx app/blocked.tsx app/admin/applications.tsx app/admin/reports.tsx "app/user/[username].tsx" "app/(gate)/invite.tsx" app/follows.tsx src/components/UserRow.tsx src/components/TagPicker.tsx src/components/MentionSuggestions.tsx src/components/PendingPostCard.tsx src/components/ProfileHeader.tsx src/components/MemberText.tsx src/components/EmptyState.tsx src/components/EraList.tsx src/theme/index.ts tests/theme.test.ts app.json tests/video-playback.test.ts tests/galleryLanding.test.ts tests/stableCards.test.ts tests/comment-menu.test.ts tests/thread-menu.test.ts tests/member-names.test.ts tests/admin-queue-pages.test.ts tests/likes-own-0042.test.ts tests/outbox.test.ts e2e/launch-test.mjs
npx tsc --noEmit && npx vitest run
git commit -m "Remove the Editorial feed preview"
```

The `checkout` line is right when the branch has every change
`claude/product-polish` has made to those files (as it does just after
merging it) and no change of its own to them besides the experiment's. If
not, take the experiment's hunks out of them by hand instead
(`git diff claude/product-polish claude/editorial-feed-preview -- <file>`
shows exactly what to remove). In `app/(tabs)/index.tsx`, besides the
same lines as the gallery's, they are the import of `EditorialPendingCard`,
the `PendingCard` line with the comment above it, and `<PendingCard`, which
goes back to `<PendingPostCard`; `FeedCard` goes from the list after
`renderItem`, and `viewerId={userId}` and `userId` in that list stay (they
are `claude/product-polish`'s). In `src/components/PendingPostCard.tsx`
`usePendingCard`, `PendingStatus` (with `StatusLook`'s `cap` and the
`maxFontSizeMultiplier={set.cap}` on its words), `ProgressRule`'s `look`
and `ORIGINAL_STATUS` go back into the card's body as they were. In
`app/gallery.tsx` those are the three
imports (`EditorialPostCard`, `useFeedLayout`, `useFeedBackground`), the
`FeedCard` and `paper` lines with the comment above them, `style={paper}` on
the `Screen`, `headerStyle: paper …` in the `Stack.Screen` options, and
`<FeedCard`, which goes back to `<PostCard`; and, as in `app/messages/[id].tsx`
and `app/user/[username].tsx`, the import from `@/utils/nameFace`, the
`const titleStyle = useNameTitleStyle(…);` line with the comment above it,
and `, headerTitle: nameHeaderTitle(titleStyle), headerTitleStyle: titleStyle`
in each `Stack.Screen`'s options with the import of `nameHeaderTitle` (in
`app/messages/[id].tsx` the `headerTitleStyle: titleStyle,` line, and the
title link's `<NameTitle tintColor={tintColor} style={titleStyle}>`, which
goes back to
`<HeaderTitle tintColor={tintColor} style={[styles.title, { maxWidth: Math.max(120, width - 150) }]}>`
(and its closing tag to `</HeaderTitle>`), with `HeaderTitle` imported
from `@react-navigation/elements` again, `useWindowDimensions` from
`react-native`, and `const { width } = useWindowDimensions();` back under
`const peer`, and the import of `NameTitle` goes). In
every file the names' face touches, they are the import from
`@/utils/nameFace` (`useNameFace`), the `const face = useNameFace();` line
with the comment above it, and each place it is used: `[style, face(n)]`
and `[style, face(n, "alone")]` go back to `style` (in `app/messages/index.tsx`,
`[styles.username, unread && styles.unreadText, face(15, "alone")]`
and in `app/post/[id].tsx`,
`[styles.withName, t.status === "pending" && styles.withPending, face(12)]`
lose only the face; in `app/messages/[id].tsx` the link to a photograph's
author loses its `style={face(11)}`; in `src/components/ProfileHeader.tsx`
the array with its `? face(15, "alone") : undefined` goes back to the plain style;
in `app/admin/reports.tsx` `nameOf`'s link goes back to
`style={styles.name}`; in `app/compose.tsx` and
`src/components/MentionSuggestions.tsx` the `face(n) && styles.…Alone`
before the face goes with the face, and so do the `tagNamesAlone` and
`usernameAlone` rules and `nameRoom` from the import), each `size={…}`
handed to `MentionText`, and each `<NameEdge … />` line, with `NameEdge`
from the import of `@/components/MemberText` (in
`src/components/feed/EditorialPostCard.tsx`, gone as a whole, too). In
`src/components/MemberText.tsx`, `MentionText`'s `size` prop, its
`const face` and the face in an @name's style go, and so do `NamedWords`,
`edge`, `NameEdge`, `SLOT`, the `USERNAME_RE` import and the import from
`@/utils/nameFace`; in `app/user/[username].tsx` each
`<NamedWords words={…} …/>` goes back to the words its function writes
(`You blocked {profile.username}`, and the two sentences as strings with
`profile.username`) and its import goes; in `app/admin/applications.tsx`
the inviter's line goes back to `invited by {item.inviter}`, and in
`app/(gate)/invite.tsx` the blurb's `<NamedWords …/>` goes back to the two
sentences as strings with `inviter`, and its import goes; in
`src/components/EmptyState.tsx` the `name` prop, the function body and
`NamedWords` go, `app/follows.tsx` hands it its two sentences as strings
with `username` again (`undefined` while there is none), and
`src/components/EraList.tsx` hands it `empty.body` and no `name`; in
`app/(tabs)/_layout.tsx` the Profile tab's title loses `titleStyle` and
`nameTitle`, and `useWindowDimensions`, `fontScale` and `styles.nameTitle`
go. Afterwards
`git diff claude/product-polish -- app src tests e2e`
should be empty, and
`git grep -n -e EditorialPostCard -e EditorialPendingCard -e feedLayout -e feedPaper -e useFeedBackground -e nameFace -e NameFace -e NameEdge -e NameTitle -e nameHeaderTitle -e Cormorant -- app src tests e2e`
should find nothing.

## On phones that tried it

Once the code is gone nothing reads `feed-layout.json` or `feed-paper.json`,
and everyone sees the original feed on the app's paper. The files are a few
bytes each and can be left.
