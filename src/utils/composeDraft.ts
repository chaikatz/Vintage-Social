import { isNoFilter } from "@/filters/presets";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";
import type { PostDraft } from "@/uploads";
import type { ProfileRow } from "@/types/db";

/**
 * What the compose screen hands the outbox, worked out without React.
 *
 * Share used to run the whole post inline: bake, two resizes, two uploads,
 * the insert, the tags, then two timed waits, all before the member could
 * leave. Now compose does only what needs the screen, which is developing a
 * photograph's film through the on-screen renderer, and hands the rest to
 * the outbox as one `PostDraft`. These are the pieces of that hand-over
 * that are plain logic: the guard against a second tap, the develop
 * decision, the clip length the database will accept, and the draft itself
 * built from the choices as they stood at the tap. They live here so they
 * can be tested without a phone.
 */

// ---------------------------------------------------------------------------
// The clip's length
// ---------------------------------------------------------------------------

/**
 * How far over the limit a clip may run and still be taken as a 60 second
 * one. The system trimmer cuts on frame boundaries, so a clip trimmed to
 * the full minute can come back a few frames long. Anything that rounds to
 * 60 seconds is the minute the member asked for.
 */
export const CLIP_LENGTH_GRACE_MS = 499;

/**
 * Seconds as the database stores them: whole, and between 1 and 60, which
 * is the posts table's CHECK. The picker reports milliseconds and the old
 * rounding let a 60.6 s clip through as 61, which the insert then refused
 * after the whole clip had gone up. Unknown or empty lengths stay null; the
 * column allows that and the outbox reads the real length off the bake.
 */
export function clampDurationSeconds(seconds: number | string | null | undefined): number | null {
  const n = typeof seconds === "string" ? Number(seconds) : seconds;
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_VIDEO_SECONDS, Math.max(1, Math.round(n)));
}

/** The picker's milliseconds as the editor's duration parameter: clamped seconds, or 0 when unknown. */
export function clipSeconds(durationMs: number | null | undefined): number {
  if (durationMs == null) return 0;
  return clampDurationSeconds(durationMs / 1000) ?? 0;
}

/** A clip too long to post, even allowing for the trimmer's last few frames. */
export function clipTooLong(durationMs: number | null | undefined): boolean {
  if (durationMs == null || !Number.isFinite(durationMs)) return false;
  return durationMs > MAX_VIDEO_SECONDS * 1000 + CLIP_LENGTH_GRACE_MS;
}

// ---------------------------------------------------------------------------
// One post per tap
// ---------------------------------------------------------------------------

export type ShareState = "idle" | "sharing" | "shared";

/**
 * A synchronous guard on the Share button. The button only disables itself
 * after React renders, so two quick taps used to start two posts. The
 * guard is checked and set in the tap itself, before anything awaits.
 */
export interface ShareGuard {
  readonly state: ShareState;
  /** True when this tap may go ahead. Every later tap is refused until `fail`. */
  begin(): boolean;
  /** The draft is in the outbox: nothing more is shared from this screen. */
  succeed(): void;
  /** The draft could not be kept: the member is still here and may tap again. */
  fail(): void;
}

export function createShareGuard(): ShareGuard {
  let state: ShareState = "idle";
  return {
    get state() {
      return state;
    },
    begin() {
      if (state !== "idle") return false;
      state = "sharing";
      return true;
    },
    succeed() {
      if (state === "sharing") state = "shared";
    },
    fail() {
      if (state === "sharing") state = "idle";
    },
  };
}

// ---------------------------------------------------------------------------
// Developing
// ---------------------------------------------------------------------------

export interface DevelopInput {
  kind: "photo" | "video";
  /** The editor's own file: the prepared photograph, or the clip as picked. */
  uri: string;
  width: number | null;
  height: number | null;
  filterId: string;
  /** The renderer could not read the photograph. */
  renderFailed: boolean;
  /** This build can put the film into a clip natively. */
  canBakeVideo: boolean;
  demo: boolean;
}

/** What developing left the post with: the `PostDraft` fields compose decides. */
export interface Developed {
  sourceUri: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  filterBaked: boolean;
  bakeVideo: boolean;
}

export interface BakedFrame {
  uri: string;
  width: number;
  height: number;
}

/** The on-screen bake. Undefined when the renderer is not mounted any more. */
export type BakeOnScreen = () => Promise<BakedFrame | null | undefined>;

/**
 * Whether Share has to wait for the renderer. Only a photograph with a film
 * does: None leaves the pixels as they are, a photograph the renderer could
 * not read has nothing to bake, and a clip is developed natively by the
 * outbox, away from the screen.
 */
export function bakesOnScreen(input: Pick<DevelopInput, "kind" | "filterId" | "renderFailed">): boolean {
  return input.kind === "photo" && !input.renderFailed && !isNoFilter(input.filterId);
}

/**
 * The develop phase of Share. It never fails: a bake that cannot happen
 * (the renderer is still loading, lost its context, or read an empty
 * texture) must not cost the post. The photograph then goes as it is,
 * marked unbaked, and wears its film on screen until someone opens it, the
 * way an unbaked post always has.
 */
export async function developForPost(input: DevelopInput, bake: BakeOnScreen): Promise<Developed> {
  const asIs = { sourceUri: input.uri, sourceWidth: positive(input.width), sourceHeight: positive(input.height) };
  if (input.kind === "video") {
    // The clip goes as picked; the outbox runs the native bake, which does
    // not need this screen, and the demo and the browser have none to run.
    return { ...asIs, filterBaked: false, bakeVideo: input.canBakeVideo && !input.demo };
  }
  // None is the photograph exactly as it was taken: there is no film to put
  // into its pixels, so it is already what will be posted.
  if (isNoFilter(input.filterId)) return { ...asIs, filterBaked: true, bakeVideo: false };
  if (input.renderFailed) return { ...asIs, filterBaked: false, bakeVideo: false };
  try {
    const out = await bake();
    if (out && typeof out.uri === "string" && out.uri && positive(out.width) && positive(out.height)) {
      return { sourceUri: out.uri, sourceWidth: out.width, sourceHeight: out.height, filterBaked: true, bakeVideo: false };
    }
  } catch {
    // Falls through to the unbaked photograph below.
  }
  return { ...asIs, filterBaked: false, bakeVideo: false };
}

function positive(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

/** What `placeFields` writes for a place chosen on the map. */
export interface PlaceFields {
  location: string | null;
  place_id: string | null;
  lat: number | null;
  lng: number | null;
}

/** The place as compose holds it: a map place's fields, the words alone, or nothing. */
export type PlaceInput = { kind: "place"; fields: PlaceFields } | { kind: "text"; text: string } | null;

export type DraftAuthor = PostDraft["author"];

/** Every choice on the compose screen, frozen at the tap. */
export interface ComposeChoices {
  /** Minted once per compose session, so a second try is the same post. */
  postId: string;
  userId: string;
  kind: "photo" | "video";
  /** The route's duration parameter, in seconds. Read for a clip only. */
  duration: string | number | null | undefined;
  filterId: string;
  showDateStamp: boolean;
  caption: string;
  /** When the shutter fired, or empty when the file did not say. */
  takenAt: string | null | undefined;
  place: PlaceInput;
  tagIds: readonly string[];
  /** The Darkroom's library identifier, when the photograph came from there. */
  assetId: string | null | undefined;
  author: DraftAuthor;
}

/**
 * The member as the pending card draws them, from the session profile. A
 * signed-in member on this screen always has one; should it not have
 * loaded, the card still has the right id and draws a quiet blank name
 * rather than someone else's.
 */
export function authorFrom(
  profile: Pick<ProfileRow, "id" | "username" | "full_name" | "avatar_url"> | null | undefined,
  userId: string,
): DraftAuthor {
  if (profile && profile.id === userId) {
    return { id: profile.id, username: profile.username, full_name: profile.full_name, avatar_url: profile.avatar_url };
  }
  return { id: userId, username: "", full_name: null, avatar_url: null };
}

/**
 * Where it was taken, as the post stores it. The place is the one chosen,
 * with its own point: never the phone's location, never a guess from the
 * words. Words alone carry no point.
 */
export function placeOf(place: PlaceInput): Pick<PostDraft, "location" | "lat" | "lng" | "placeId"> {
  if (place?.kind === "place") {
    return {
      location: place.fields.location?.trim() || null,
      lat: place.fields.lat,
      lng: place.fields.lng,
      placeId: place.fields.place_id,
    };
  }
  if (place?.kind === "text") return { location: place.text.trim() || null, lat: null, lng: null, placeId: null };
  return { location: null, lat: null, lng: null, placeId: null };
}

/** The outbox's draft, from the frozen choices and what developing made of the picture. */
export function buildPostDraft(choices: ComposeChoices, developed: Developed): PostDraft {
  const isVideo = choices.kind === "video";
  return {
    id: choices.postId,
    userId: choices.userId,
    kind: choices.kind,
    sourceUri: developed.sourceUri,
    sourceWidth: developed.sourceWidth,
    sourceHeight: developed.sourceHeight,
    durationSeconds: isVideo ? clampDurationSeconds(choices.duration) : null,
    filterId: choices.filterId,
    filterBaked: isVideo ? false : developed.filterBaked,
    bakeVideo: isVideo ? developed.bakeVideo : false,
    showDateStamp: choices.showDateStamp,
    caption: choices.caption.trim(),
    takenAt: choices.takenAt || null,
    ...placeOf(choices.place),
    // A member tagged twice is one tag; the order chosen is kept.
    tagIds: [...new Set(choices.tagIds)],
    assetId: choices.assetId || null,
    author: { ...choices.author },
  };
}
