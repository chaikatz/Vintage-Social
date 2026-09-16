import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cleanToken, rpc } from "../src/share/backend";
import { publicSharePage, type SharedPhotograph } from "../src/share/publicPage";

/**
 * A shared photograph: https://<host>/s/<token>
 *
 * Real HTML with real meta tags, like the invitation page, so a link
 * pasted into a story or a message unfurls with the photograph rather than
 * a grey bubble. The database is asked one question — `shared_post` — and
 * answers with the shape and words of the one photograph the member chose
 * to share, or nothing. The picture itself is not an address in the store:
 * the page points at `/s/<token>/media`, which asks again on every request
 * (see `share-media.ts`). Nothing this page receives can name a file.
 *
 * `/s/<token>/request` notes that someone asked to join and sends them to
 * the club's own application form.
 */

type Lookup = { state: "ok"; photograph: SharedPhotograph | null } | { state: "unavailable" };

async function lookup(token: string): Promise<Lookup> {
  try {
    const res = await rpc("shared_post", { p_token: token });
    if (!res || !res.ok) return { state: "unavailable" };
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { state: "ok", photograph: null };
    return {
      state: "ok",
      photograph: {
        mediaType: row.media_type === "video" ? "video" : "photo",
        hasPoster: row.has_poster === true,
        width: typeof row.width === "number" ? row.width : null,
        height: typeof row.height === "number" ? row.height : null,
        location: typeof row.location === "string" ? row.location : null,
        takenAt: typeof row.taken_at === "string" ? row.taken_at : null,
        createdAt: typeof row.created_at === "string" ? row.created_at : "",
        username: typeof row.username === "string" && row.username ? row.username : "a member",
      },
    };
  } catch {
    return { state: "unavailable" };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = cleanToken(req.query.token);
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
