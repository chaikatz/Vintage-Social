/**
 * The quick reactions over the comment field, in the order they sit.
 *
 * The one place VINTAGE draws emoji itself: the owner asked for the row
 * Instagram has over its comment field, and these are its eight. Each is
 * a tap that puts the emoji into the comment at the caret, nothing sent
 * until Post. VoiceOver reads each by its name, never the picture.
 */
export const QUICK_REACTIONS: readonly { emoji: string; name: string }[] = [
  { emoji: "\u2764\uFE0F", name: "Heart" },
  { emoji: "\u{1F64C}", name: "Raised hands" },
  { emoji: "\u{1F525}", name: "Fire" },
  { emoji: "\u{1F44F}", name: "Clapping" },
  { emoji: "\u{1F622}", name: "Crying" },
  { emoji: "\u{1F60D}", name: "Heart eyes" },
  { emoji: "\u{1F62E}", name: "Surprised" },
  { emoji: "\u{1F602}", name: "Tears of joy" },
];
