import { DEMO_PREFIX } from "@/demo/photos";

/**
 * Does this post still need its filter applied at display time?
 *
 * A photograph published through VINTAGE is baked at compose time — the
 * filter ends up in the pixels — so applying it again on screen would
 * double it. Three kinds are not baked:
 *
 *   * video, because burning a filter into footage needs a transcode
 *     VINTAGE doesn't do yet, so it is applied live on every play;
 *   * the bundled demo library, which ships as plain photographs;
 *   * the house photographs, which are public-domain images referenced by
 *     their original https url rather than uploaded through the pipeline.
 *
 * The test for that last one is the scheme. A real upload is stored as a
 * bucket-relative key with no scheme at all ("{uid}/{postId}.jpg") and the
 * public url is built when it is read. So an http(s) path means the file
 * came from somewhere else and was never baked.
 *
 * It deliberately does not match file: or blob:, which is what a photograph
 * baked in demo mode looks like — those are already filtered, and matching
 * them would apply the filter twice.
 */
export function needsDisplayFilter(post: {
  media_type: string;
  media_path: string;
}): boolean {
  if (post.media_type === "video") return true;
  if (post.media_path.startsWith(DEMO_PREFIX)) return true;
  return /^https?:/i.test(post.media_path);
}
