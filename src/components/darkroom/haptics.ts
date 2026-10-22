import * as Haptics from "expo-haptics";

/**
 * The room's haptics, and only these (§5.6). None on a page turn, an end
 * page, a title card, a load, a failure, a zoom or DOWNLOAD AND DEVELOP:
 * the room is quiet, and a failure is said in words, not felt.
 */
const quietly = (p: Promise<void>) => {
  p.catch(() => undefined);
};

export const haptics = {
  /** DEVELOP tapped, once per attempt. */
  develop: () => quietly(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  /** SET ASIDE turned on. */
  setAside: () => quietly(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** SET ASIDE turned off: PUT BACK, or REMOVE. */
  putBack: () => quietly(Haptics.selectionAsync()),
  /** A chapter, a year or a month chosen in Contents. */
  chosen: () => quietly(Haptics.selectionAsync()),
};
