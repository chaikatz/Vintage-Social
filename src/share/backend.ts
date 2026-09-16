/**
 * What the share pages' server knows about the database, and nothing more.
 *
 * Both Vercel functions — the page at `/s/<token>` and the picture at
 * `/s/<token>/media` — go through here. Each asks the database exactly one
 * question, with the anonymous key, and the database answers only for a
 * token that is still live: a share that has not been turned off, of a
 * post that still exists and has not been removed, by a member still in
 * good standing. Everything else is silence.
 *
 * The storage path of the photograph is learned here and used here, to
 * fetch the bytes; it is never sent onward. The database gives it up only
 * to a caller holding the server's key (SHARE_MEDIA_KEY), so someone with
 * a valid token and the public anonymous key, calling the database
 * directly, learns nothing a browser could not. No React Native imports.
 */

export interface Backend {
  url: string;
  /** The anonymous key: public by design, the same one the app carries. */
  key: string;
  /**
   * The server's own key for `shared_post_media`, from the server-only
   * environment variable SHARE_MEDIA_KEY. Its SHA-256 is in the database;
   * without it the database names no file. Never in a bundle, a reply or a
   * log — it goes into one request body, to the database, and nowhere else.
   */
  mediaKey: string | null;
}

export const TOKEN = /^[a-f0-9]{32}$/;

/** The token as a route gives it, or "" when it is not one. */
export function cleanToken(raw: unknown): string {
  const t = String(raw ?? "").trim().toLowerCase();
  return TOKEN.test(t) ? t : "";
}

export function backend(env: Record<string, string | undefined> = process.env): Backend | null {
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const mediaKey = env.SHARE_MEDIA_KEY?.trim() || null;
  return url && key ? { url: url.replace(/\/+$/, ""), key, mediaKey } : null;
}

/** One remote procedure call, as the anonymous role. Null when the server is not configured. */
export async function rpc(name: string, body: Record<string, unknown>): Promise<Response | null> {
  const b = backend();
  if (!b) return null;
  return fetch(`${b.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: b.key, Authorization: `Bearer ${b.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
}

/** Where a stored file lives. Seeded rows carry whole URLs; real uploads carry a path inside the bucket. */
export function storageUrl(b: Backend, bucket: "media" | "thumbnails", path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${b.url}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export type MediaKind = "media" | "poster";

export interface MediaSource {
  /** The file's real address — for the server's own fetch, never for a reply. */
  url: string;
  mediaType: "photo" | "video";
  kind: MediaKind;
}

export type MediaLookup = { state: "ok"; source: MediaSource | null } | { state: "unavailable" };

/**
 * The file behind a live share, or nothing. Asked on every request for the
 * picture, so that "Turn off" takes effect on the picture at once.
 */
export async function sharedMediaSource(token: string, kind: MediaKind): Promise<MediaLookup> {
  const b = backend();
  // No key configured is a deployment fault, not a dead link: say "unavailable", and never ask.
  if (!b || !b.mediaKey) return { state: "unavailable" };
  if (!TOKEN.test(token)) return { state: "ok", source: null };
  try {
    const res = await rpc("shared_post_media", { p_token: token, p_key: b.mediaKey });
    if (!res || !res.ok) return { state: "unavailable" };
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { state: "ok", source: null };
    const mediaType = row.media_type === "video" ? "video" : "photo";
    const path = kind === "poster" ? row.thumb_path : row.media_path;
    if (typeof path !== "string" || !path) return { state: "ok", source: null };
    return {
      state: "ok",
      source: { url: storageUrl(b, kind === "poster" ? "thumbnails" : "media", path), mediaType, kind },
    };
  } catch {
    return { state: "unavailable" };
  }
}

/** What a served picture is called: never the stored name. */
export function servedType(source: Pick<MediaSource, "mediaType" | "kind">, upstreamType: string | null): string {
  const fallback = source.kind === "media" && source.mediaType === "video" ? "video/mp4" : "image/jpeg";
  const t = (upstreamType ?? "").split(";")[0].trim().toLowerCase();
  return /^(image|video)\//.test(t) ? t : fallback;
}

/**
 * The headers a served picture carries: enough for a browser to show it
 * and seek in it, nothing that says where it came from. An allow-list, not
 * a copy — the store's own headers stay with the store.
 */
export function servedHeaders(source: Pick<MediaSource, "mediaType" | "kind">, upstream: Headers): Record<string, string> {
  const type = servedType(source, upstream.get("content-type"));
  const ext = type.startsWith("video/") ? "mp4" : type === "image/png" ? "png" : "jpg";
  const out: Record<string, string> = {
    "Content-Type": type,
    "Content-Disposition": `inline; filename="vintage.${ext}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  };
  const length = upstream.get("content-length");
  if (length && /^\d+$/.test(length)) out["Content-Length"] = length;
  const range = upstream.get("content-range");
  if (range && /^bytes /.test(range)) out["Content-Range"] = range;
  return out;
}
