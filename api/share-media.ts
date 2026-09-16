import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Readable } from "node:stream";
import { cleanToken, servedHeaders, sharedMediaSource, type MediaKind } from "../src/share/backend";

/**
 * The picture behind a shared link: https://<host>/s/<token>/media
 * (and its poster, for a film: /s/<token>/poster)
 *
 * The page never points at the store. It points here, and this asks the
 * database — on every request — whether the token still opens onto a
 * photograph: share not turned off, post not removed, author still a
 * member. If so the bytes are fetched and streamed through; if not, an
 * empty 404. So "Turn off" in the app turns the picture off along with the
 * page, and nothing about where the file lives ever reaches a browser:
 * no redirect, no address, an allow-list of headers.
 *
 * Range requests pass through so a film can be seeked; the reply is
 * marked no-store so nothing between here and the reader keeps a copy
 * past the moment the link is turned off.
 */

export const config = { supportsResponseStreaming: true, maxDuration: 60 };

const UPSTREAM_TIMEOUT_MS = 50_000;

function empty(res: VercelResponse, status: number): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.status(status).end();
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const token = cleanToken(req.query.token);
  const kind: MediaKind = String(req.query.kind ?? "") === "poster" ? "poster" : "media";
  if (!token) return empty(res, 404);
  if (req.method !== "GET" && req.method !== "HEAD") return empty(res, 405);

  const found = await sharedMediaSource(token, kind);
  if (found.state === "unavailable") return empty(res, 503);
  if (!found.source) return empty(res, 404);

  const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
  const gone = new AbortController();
  req.on?.("close", () => gone.abort());
  let upstream: Response;
  try {
    upstream = await fetch(found.source.url, {
      method: req.method,
      headers: range ? { Range: range } : undefined,
      redirect: "follow",
      signal: AbortSignal.any([gone.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });
  } catch {
    return empty(res, 502);
  }
  if (upstream.status !== 200 && upstream.status !== 206) {
    return empty(res, upstream.status === 404 ? 404 : 502);
  }

  for (const [name, value] of Object.entries(servedHeaders(found.source, upstream.headers))) {
    res.setHeader(name, value);
  }
  res.status(upstream.status);

  if (req.method === "HEAD" || !upstream.body) {
    res.end();
    return;
  }
  await new Promise<void>((resolve) => {
    const stream = Readable.fromWeb(upstream.body as never);
    const done = () => resolve();
    stream.once("error", () => {
      res.end();
      done();
    });
    res.once("close", done);
    res.once("finish", done);
    stream.pipe(res);
  });
}
