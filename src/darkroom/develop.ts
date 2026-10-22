import { Platform } from "react-native";
// NetInfo's own reading of the connection, under a name that says what it
// is: the Darkroom makes no requests of its own.
import { fetch as readNetwork, NetInfoStateType } from "@react-native-community/netinfo";
import { File } from "expo-file-system";
import { DARKROOM_MAX, prepareForDarkroom } from "@/api/media";
import { captureDateFromEpoch } from "@/utils/exif";
import { localFileFor } from "./localFile";
import {
  cancelDevelop,
  developImage,
  existing,
  libraryModule,
  onDevelopProgress,
  type NativeDevelopResult,
  type VintageLibraryNative,
} from "./nativeLibrary";
import { printFileUri } from "./printSource";
import type { Print } from "./types";

/**
 * Develop: from a print in the Darkroom to the ordinary editor.
 *
 * It happens in two steps, and the second only when the member asks for it.
 * `developLocal` reads the photograph from the phone and never from the
 * network. With the Darkroom's own module (`nativeLibrary.ts`) Photos
 * renders the current version of the photograph, with the member's own
 * crops and edits, at 2048 pixels on the long side, the still only. Without
 * it, the original's local file is decoded the way a picked photograph is
 * (`localFile.ts`). When the original lives only in iCloud the answer is
 * `inCloud`, and the room says so and waits. Only after DOWNLOAD AND
 * DEVELOP does `developFromCloud` bring it down: first a look at the
 * connection, so an offline phone hears so at once, then the download, with
 * its progress when the module can measure it.
 *
 * Every develop can be stopped. An abort settles the promise with
 * `cancelled` there and then, whatever the library is still doing; Photos
 * is told to stop when the module is present, and a copy that arrives
 * after the member stopped waiting is deleted rather than kept. A develop
 * that runs out of time (15 seconds on the phone, 60 from iCloud) is
 * stopped the same way. So a room that is leaving can abort and forget.
 *
 * What the editor is handed is `ComposeParams`, the only way in to it from
 * here: the prepared JPEG, its upright size, and the date the shutter
 * fired, which the library already gave the Darkroom. Nothing is uploaded;
 * the editor's own "Share to VINTAGE" is still the only door out.
 */

export interface ComposeParams {
  [key: string]: string;
  uri: string;
  mediaType: "photo";
  width: string;
  height: string;
  duration: string;
  takenAt: string;
  /** The library identifier, so the Darkroom knows later that this one was posted. */
  assetId: string;
  /** The editor was opened from the Darkroom. */
  from: "darkroom";
}

export type DevelopResult =
  | { status: "ok"; params: ComposeParams }
  /** The local attempt found the original only in iCloud. */
  | { status: "inCloud" }
  /** Asked to download, but the phone is offline. */
  | { status: "offline" }
  /** The download timed out, or iCloud refused. */
  | { status: "cloudFailed" }
  /** No longer in the library, or no longer shared with VINTAGE. */
  | { status: "missing" }
  /** The local read failed or timed out. */
  | { status: "unreadable" }
  | { status: "cancelled" };

/** A photograph on the phone renders well inside this. */
export const LOCAL_TIMEOUT_MS = 15_000;
/** How long an original may take to come down before the member is told iCloud didn't send it. */
export const CLOUD_TIMEOUT_MS = 60_000;
/** NetInfo answers from the phone at once; past this the connection is taken as there. */
const CONNECTION_WAIT_MS = 3_000;

const CANCELLED: DevelopResult = { status: "cancelled" };

/** Reads the print from the phone only. */
export function developLocal(print: Print, opts: { signal?: AbortSignal } = {}): Promise<DevelopResult> {
  return attempt(opts.signal, async (stop) => {
    const bundled = fromBundle(print);
    if (bundled) return bundled;
    const mod = libraryModule();
    return mod ? localThroughModule(mod, print, stop) : localThroughFile(print, stop);
  });
}

/** Brings the original down from iCloud, after the member asked. */
export function developFromCloud(
  print: Print,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<DevelopResult> {
  return attempt(opts.signal, async (stop) => {
    const bundled = fromBundle(print);
    if (bundled) return bundled;
    const net = await waitFor(connection(), CONNECTION_WAIT_MS, stop);
    if (stop.aborted) return CANCELLED;
    if (net.kind === "value" && net.value === "offline") return { status: "offline" };
    const mod = libraryModule();
    return mod ? cloudThroughModule(mod, print, stop, opts.onProgress) : cloudThroughStill(print, stop);
  });
}

/** True when a download's progress can be shown as it is (a rule that grows); false for a breathing one. */
export function progressIsMeasured(): boolean {
  return libraryModule() != null;
}

/**
 * How the phone is connected. Anything that is neither offline nor cellular
 * counts as Wi-Fi. Only the phone's own link is read: NetInfo's "internet
 * reachable" is a probe of one web address, which can fail where iCloud
 * answers perfectly well, so it is not taken as offline.
 */
export async function connection(): Promise<"offline" | "cellular" | "wifi"> {
  try {
    const state = await readNetwork();
    if (state.isConnected === false || state.type === NetInfoStateType.none) return "offline";
    return state.type === NetInfoStateType.cellular ? "cellular" : "wifi";
  } catch {
    return "wifi";
  }
}

/**
 * The given identifiers that still resolve in the library, in the order
 * given; null when that cannot be known (no module, or the library would
 * not answer), which is never the same as "none of them".
 */
export async function stillInLibrary(ids: string[]): Promise<string[] | null> {
  const mod = libraryModule();
  if (!mod) return null;
  if (ids.length === 0) return [];
  try {
    const present = new Set(await existing(mod, ids));
    return ids.filter((id) => present.has(id));
  } catch {
    return null;
  }
}

/**
 * A developed copy that was not posted is not kept. Only copies develop
 * made itself are ever deleted: a demo print's address is the app's own
 * picture and is left alone.
 */
export function discardDeveloped(uri: string | null | undefined): void {
  if (!uri || !made.has(uri)) return;
  throwAway(uri);
}

// --- Paths ------------------------------------------------------------------

async function localThroughModule(mod: VintageLibraryNative, print: Print, stop: AbortSignal): Promise<DevelopResult> {
  const requestId = nextRequestId();
  const work = developImage(mod, print.id, { maxSide: DARKROOM_MAX, allowNetwork: false, requestId });
  const outcome = await waitFor(work, LOCAL_TIMEOUT_MS, stop);
  if (outcome.kind === "value") return fromLibrary(print, outcome.value, "unreadable");
  // Out of time, or stopped: Photos stops too, and a copy it still makes is not kept.
  cancelDevelop(mod, requestId);
  throwAwayLate(work);
  return outcome.kind === "stopped" ? CANCELLED : { status: "unreadable" };
}

async function localThroughFile(print: Print, stop: AbortSignal): Promise<DevelopResult> {
  // Its own stop, so giving up on time also keeps it from making a copy.
  const quit = new AbortController();
  const relay = () => quit.abort();
  stop.addEventListener("abort", relay);
  if (stop.aborted) quit.abort();
  const work = localFileFor(print.id, quit.signal);
  const outcome = await waitFor(work, LOCAL_TIMEOUT_MS, stop);
  stop.removeEventListener("abort", relay);
  if (outcome.kind === "value") return fromLibrary(print, outcome.value, "unreadable");
  quit.abort();
  throwAwayLate(work);
  return outcome.kind === "stopped" ? CANCELLED : { status: "unreadable" };
}

async function cloudThroughModule(
  mod: VintageLibraryNative,
  print: Print,
  stop: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<DevelopResult> {
  const requestId = nextRequestId();
  // Listening starts before the request does, so no early progress is missed.
  // The rule only ever grows.
  let shown = 0;
  const stopListening = onProgress
    ? onDevelopProgress(mod, requestId, (fraction) => {
        if (stop.aborted || fraction <= shown) return;
        shown = fraction;
        onProgress(fraction);
      })
    : () => undefined;
  try {
    const work = developImage(mod, print.id, { maxSide: DARKROOM_MAX, allowNetwork: true, requestId });
    const outcome = await waitFor(work, CLOUD_TIMEOUT_MS, stop);
    if (outcome.kind === "value") return fromLibrary(print, outcome.value, "cloudFailed");
    cancelDevelop(mod, requestId);
    throwAwayLate(work);
    return outcome.kind === "stopped" ? CANCELLED : { status: "cloudFailed" };
  } finally {
    stopListening();
  }
}

/**
 * Without the module, the still is read through its `ph://` address, which
 * brings the original down when it has to. It cannot be stopped or
 * measured; a member who stops waiting is answered at once, and the copy
 * that may still arrive is deleted.
 */
async function cloudThroughStill(print: Print, stop: AbortSignal): Promise<DevelopResult> {
  const work = prepareForDarkroom("ph://" + print.id);
  const outcome = await waitFor(work, CLOUD_TIMEOUT_MS, stop);
  if (outcome.kind === "value") {
    const { uri, width, height } = outcome.value;
    return { status: "ok", params: paramsFor(print, keep(uri), width, height) };
  }
  if (outcome.kind === "error") {
    return /not found/i.test(messageOf(outcome.error)) ? { status: "missing" } : { status: "cloudFailed" };
  }
  work.then((late) => throwAway(late.uri)).catch(() => undefined);
  return outcome.kind === "stopped" ? CANCELLED : { status: "cloudFailed" };
}

/** The browser demo's prints, and anything else not in Photos, are the app's own pictures: no library to read. */
function fromBundle(print: Print): DevelopResult | null {
  if (Platform.OS !== "web" && typeof print.uri === "string" && print.uri.startsWith("ph://")) return null;
  const uri = printFileUri(print.uri);
  return uri ? { status: "ok", params: paramsFor(print, uri, print.width, print.height) } : { status: "missing" };
}

function fromLibrary(
  print: Print,
  result: NativeDevelopResult,
  failure: "unreadable" | "cloudFailed",
): DevelopResult {
  switch (result.status) {
    case "ok":
      return { status: "ok", params: paramsFor(print, keep(result.uri), result.width, result.height) };
    case "inCloud":
      // Asked with the network allowed, "in iCloud" can only mean iCloud did not send it.
      return failure === "unreadable" ? { status: "inCloud" } : { status: "cloudFailed" };
    case "missing":
      return { status: "missing" };
    default:
      return { status: failure };
  }
}

function paramsFor(print: Print, uri: string, width: number, height: number): ComposeParams {
  return {
    uri,
    mediaType: "photo",
    width: String(Math.round(width)),
    height: String(Math.round(height)),
    duration: "0",
    // When the shutter fired, as Photos dates it; before 1970 is a real date too.
    takenAt: captureDateFromEpoch(print.takenAt) ?? "",
    assetId: print.id,
    from: "darkroom",
  };
}

// --- Stopping and waiting -----------------------------------------------------

/**
 * Runs one develop under the member's signal. An abort answers `cancelled`
 * at once; the work is told through `stop` and left to wind down, and an
 * `ok` it reaches afterwards has its copy deleted.
 */
function attempt(
  signal: AbortSignal | undefined,
  body: (stop: AbortSignal) => Promise<DevelopResult>,
): Promise<DevelopResult> {
  if (signal?.aborted) return Promise.resolve(CANCELLED);
  const stop = new AbortController();
  return new Promise<DevelopResult>((resolve) => {
    let answered = false;
    const onAbort = () => {
      stop.abort();
      if (answered) return;
      answered = true;
      resolve(CANCELLED);
    };
    signal?.addEventListener("abort", onAbort);
    const finish = (result: DevelopResult) => {
      signal?.removeEventListener("abort", onAbort);
      if (answered) {
        // The member stopped first; whatever was made after is not kept.
        if (result.status === "ok") discardDeveloped(result.params.uri);
        return;
      }
      answered = true;
      resolve(result);
    };
    body(stop.signal).then(finish, () => finish({ status: "unreadable" }));
  });
}

type Outcome<T> =
  | { kind: "value"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" }
  | { kind: "stopped" };

/** Waits for `work`, but no longer than `ms`, and not a moment past `stop`. */
function waitFor<T>(work: Promise<T>, ms: number, stop: AbortSignal): Promise<Outcome<T>> {
  return new Promise<Outcome<T>>((resolve) => {
    let done = false;
    const finish = (outcome: Outcome<T>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop.removeEventListener("abort", onStop);
      resolve(outcome);
    };
    const onStop = () => finish({ kind: "stopped" });
    const timer = setTimeout(() => finish({ kind: "timeout" }), ms);
    stop.addEventListener("abort", onStop);
    if (stop.aborted) onStop();
    work.then(
      (value) => finish({ kind: "value", value }),
      (error: unknown) => finish({ kind: "error", error }),
    );
  });
}

let requests = 0;

function nextRequestId(): string {
  requests += 1;
  return `develop-${Date.now().toString(36)}-${requests}`;
}

// --- Copies -------------------------------------------------------------------

/** Copies develop made and handed out, not yet thrown away. */
const made = new Set<string>();

function keep(uri: string): string {
  made.add(uri);
  return uri;
}

/** A copy that arrived after develop stopped waiting for it. */
function throwAwayLate(work: Promise<NativeDevelopResult>): void {
  work
    .then((late) => {
      if (late.status === "ok") throwAway(late.uri);
    })
    .catch(() => undefined);
}

function throwAway(uri: string): void {
  made.delete(uri);
  if (Platform.OS === "web" || !uri.startsWith("file:")) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A copy that cannot be removed now lives in the caches, which iOS clears.
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}
