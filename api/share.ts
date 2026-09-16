import type { VercelRequest, VercelResponse } from "@vercel/node";
import { publicSharePage, type SharedPhotograph } from "../src/share/publicPage";

/**
 * A shared photograph: https://<host>/s/<token>
 *
 * Real HTML with real meta tags, like the invitation page, so a link
 * pasted into a story or a message unfurls with the photograph rather than
 * a grey bubble. The database is asked one question — `shared_post` — and
 * answers with the one photograph the member chose to share, or nothing.
 * There is no other query this page can make.
 *
 * `/s/<token>/request` notes that someone asked to join and sends them to
 * the club's own application form.
 */

const TOKEN = /^[a-f0-9]{32}$/;

type Lookup = { state: "ok"; photograph: SharedPhotograph | null } | { state: "unavailable" };

function config(): { url: string; key: string } | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

async function rpc(name: string, body: Record<string, unknown>): Promise<Response | null> {
  const c = config();
  if (!c) return null;
  return fetch(`${c.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
}

/** Public URL of a stored file — the buckets are public, the paths are not guessable. */
function fileUrl(bucket: string, path: string | null): string | null {
  const c = config();
  if (!c || !path) return null;
  // Seeded rows carry whole URLs; real uploads carry a path inside the bucket.
  if (/^https?:\/\//i.test(path)) return path;
  return `${c.url}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function lookup(token: string): Promise<Lookup> {
  try {
    const res = await rpc("shared_post", { p_token: token });
    if (!res || !res.ok) return { state: "unavailable" };
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { state: "ok", photograph: null };
    const mediaType = row.media_type === "video" ? "video" : "photo";
    const mediaUrl = fileUrl("media", String(row.media_path ?? ""));
    if (!mediaUrl) return { state: "ok", photograph: null };
    return {
      state: "ok",
      photograph: {
        mediaUrl,
        posterUrl: fileUrl("thumbnails", (row.thumb_path as string | null) ?? null),
        mediaType,
        width: typeof row.width === "number" ? row.width : null,
        height: typeof row.height === "number" ? row.height : null,
        location: (row.location as string | null) ?? null,
        takenAt: (row.taken_at as string | null) ?? null,
        createdAt: String(row.created_at ?? ""),
        username: String(row.username ?? "a member"),
      },
    };
  } catch {
    return { state: "unavailable" };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = String(req.query.token ?? "").trim().toLowerCase();
  const token = TOKEN.test(raw) ? raw : "";
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "vintagesocial.app");
  const origin = `${proto}://${host}`;

  // Someone asked to join from this page: note it, then the club's own form.
  if (String(req.query.go ?? "") === "request") {
    if (token) {
      try {
        await rpc("record_share_event", { p_token: token, p_kind: "membership_requested" });
      } catch {
        // The ledger is a courtesy; the door still opens.
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, "/apply");
    return;
  }

  const found: Lookup = token ? await lookup(token) : { state: "ok", photograph: null };
  const unavailable = found.state === "unavailable";
  const photograph = found.state === "ok" ? found.photograph : null;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Each visit is counted by the database, so the page must not be cached
  // between people; a crawler and a reader each ask.
  res.setHeader("Cache-Control", "no-store");
  res.status(unavailable ? 503 : photograph ? 200 : 404);
  res.send(publicSharePage({ origin, token, photograph, unavailable }));
}
