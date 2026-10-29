/**
 * The words VINTAGE stands behind, in the app's own copy.
 *
 * These are the same documents served at /privacy and /terms on the
 * invitation site (public/privacy.html, public/terms.html). Keep the two
 * in step: a change here is a change there. Plain paragraphs; a line
 * beginning with "## " is a heading.
 *
 * DRAFTED FOR LAUNCH — a lawyer has not read these. They describe what
 * the app actually does, which is the part that has to be true; the
 * legal framing is the part to have checked.
 */

export type LegalDoc = "privacy" | "terms";

export const LEGAL_TITLES: Record<LegalDoc, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Use",
};

export const LEGAL_UPDATED = "October 29, 2026";

export const PRIVACY_POLICY = `VINTAGE is a small, invitation-only club for photographs. This policy says what we collect, why, and what you can do about it.

## What we collect

Account details. Your email address and a password (stored as a hash by our authentication provider), the name and username you choose, and an optional portrait, bio and city.

Your application. If you apply for membership, the answers you give — who you are, what you photograph, who sent you — are read by a person who decides on your membership. Applications are kept while your application is pending or waitlisted.

What you post. Photographs and short films you publish, the filter you chose, your caption, the place you name, the members you tag, your likes and comments, who you follow, and the messages you send to other members.

Capture dates. With your permission, VINTAGE reads the date a photograph or film was taken from the file you choose, so the date stamp says when the shutter fired. VINTAGE does not read your location from your photographs and does not track where you are. A place on a post is the one you typed or picked by name.

Your photo library, in the Memory Room. If you allow it, the Memory Room shows you photographs already on your phone so you can find one worth posting. It chooses them by the date each was taken and by what your library records about each one, such as its size and whether it is a screenshot — never by place, and never by looking at what is in the picture. It does not look through your Hidden album. Nothing about your library — not the photographs, their dates, or how many there are — is sent to us or to anyone else. So that it does not repeat itself, the Memory Room keeps a short list on your phone of the library’s own identifiers and when each was added: photographs you looked at, for up to two months; photographs you posted from it, for a year; and photographs you set aside, until you put them back. It also keeps where you left off, which it offers back for twelve hours. For the photographs you set aside and those around where you left off, it keeps the date each was taken and its size as well, so it can show them again. It also notes which VINTAGE account the list belongs to. The list is deleted when you sign out. If you are signed out some other way, for example from another device, it is deleted the next time the app hears from VINTAGE that you were, and always before anyone else who signs in on this phone could see it. “Forget what the Memory Room has shown me” in Settings clears what it has shown you and where you left off, but keeps the photographs you set aside. Like the rest of the app’s data on your phone, the list can be included in your phone’s own backup. When a photograph is kept in iCloud, iOS brings a screen-sized copy from your own iCloud account to show it, as Photos does; VINTAGE downloads the photograph itself only when you ask it to develop it. Only a photograph you choose to post is uploaded.

Device token. If you allow notifications, a token that lets us send them to your phone. It is deleted when you sign out.

Diagnostics. Our hosting providers keep ordinary server logs (such as IP address and request time) to run the service.

## What we do not do

We do not sell your information. We do not show advertising. We do not use your photographs to train anything. We do not read your contacts. We do not upload anything from your photo library except the photographs you post.

## Who can see what

VINTAGE is members-only. Your profile and photographs are visible to approved members. A private account is visible only to the members you have accepted. Messages are visible to the two people in the conversation. Admins can see content in order to review reports and keep the club safe.

## Where it is kept

Data is stored with Supabase (database, authentication and file storage) and delivered through their infrastructure. Push notifications are delivered through Expo’s push service and Apple. Invitation pages are hosted on Vercel.

## Your choices

You can edit your profile, delete any photograph or comment you posted, remove yourself from a tag, turn each kind of notification off, block another member, and delete your account — all from within the app. Deleting your account removes your profile, photographs, comments, likes, follows, tags and messages. Some records may persist in backups for a limited period, and reports you filed are kept for moderation history without your account attached.

## Children

VINTAGE is for people aged 17 and over. We do not knowingly accept members under 17.

## Changes and contact

If this policy changes in a way that matters, we will say so in the app. Questions go to the support address shown in Settings.`;

export const TERMS_OF_USE = `These terms are the agreement between you and VINTAGE when you use the app.

## Membership

VINTAGE is by application or invitation. Membership can be declined, waitlisted, suspended or ended by the club's admins, and you can leave at any time by deleting your account. Each member is issued a permanent membership number; it is never reassigned.

## Your photographs

You keep every right to what you post. You give VINTAGE the permission needed to store and show your photographs, films and words to the members who are allowed to see them, and to make them available to you and to the people you share a print with. Post only work you have the right to post.

## Conduct

VINTAGE is a quiet place. Do not post content that is unlawful, hateful, harassing, sexually explicit, violent, or that reveals someone's private information. Do not impersonate others, spam, or promote. Do not post other people's work as your own.

Anyone can report a photograph, comment or member from within the app. Reports are read by people, not machines. The admins may remove content, warn, suspend or remove a member for breaking these terms, and act on reports within 24 hours of receiving them. You can block any member; once blocked, neither of you sees the other's content.

## Invitations

Members may invite others with their invitation link. An invitation is spent when someone joins through it. Invitations are for people you know; sharing them publicly may lead to their withdrawal.

## The service

VINTAGE is provided as it is. We work to keep it available and your photographs safe, but we cannot promise uninterrupted service, and we are not liable for loss arising from its use to the extent the law allows. We may change or discontinue features.

## Ending

You may delete your account at any time from Settings. We may end your membership for breaking these terms. Sections about your content, conduct and liability continue to apply to the period you were a member.

## Contact

Questions about these terms go to the support address shown in Settings.`;

export function legalText(doc: LegalDoc): string {
  return doc === "privacy" ? PRIVACY_POLICY : TERMS_OF_USE;
}
