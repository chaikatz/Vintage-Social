import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * apple-app-site-association — what makes https://<host>/i/<slug> open the
 * app directly instead of the browser.
 *
 * Apple fetches this over HTTPS, follows no redirects, and wants
 * application/json. It needs the ten-character Apple Team ID, which is not
 * a secret but is not in the repository either, so it comes from the
 * environment. Without it this returns 404 on purpose: an incomplete file
 * would be cached by Apple and the association would silently not work.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const team = process.env.APPLE_TEAM_ID;
  const bundle = process.env.APPLE_BUNDLE_ID ?? "com.vintage.social";

  if (!team) {
    res.status(404).json({ error: "APPLE_TEAM_ID is not set" });
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({
    applinks: {
      details: [{ appIDs: [`${team}.${bundle}`], components: [{ "/": "/i/*" }] }],
    },
  });
}
