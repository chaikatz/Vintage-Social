import { DEMO_PREFIX } from "@/demo/photos";

/**
 * Does this post still need its filter applied at display time?
 *
 * A photograph published through VINTAGE is baked at compose time — the
 * filter ends up in the pixels — so applying it again on screen would
 * double it. Four kinds are not baked:
 *
 *   * a photograph the darkroom could not bake — the renderer was not
 *     ready, or lost its context — and posted as it is rather than not at
 *     all. `filter_baked` is false for it (migration 0020 marks every
 *     photograph from before that path existed as baked, since they were);
 *   * video that was not baked — every clip posted before the phone could
 *     bake one, and any posted from a build that cannot. `filter_baked`
 *     is the record of which it was;
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
  filter_baked?: boolean;
}): boolean {
  if (post.media_type === "video") return !post.filter_baked;
  if (post.filter_baked === false) return true;
  if (post.media_path.startsWith(DEMO_PREFIX)) return true;
  return /^https?:/i.test(post.media_path);
}
