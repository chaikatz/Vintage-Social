import React from "react";
import { useWindowDimensions } from "react-native";
import { HeaderTitle } from "@react-navigation/elements";
import { nameTitleStyle, type TitleStyle } from "@/utils/nameFace";

/**
 * Editorial (Preview): a bar's title that is a username, drawn as the stack
 * draws a title of its own (HeaderTitle, the title as a Text), so that the
 * room the title style gives the face's letters is drawn with them: the
 * bar's own label draws only within its letters' widths, and would cut the
 * tails off. At most as wide as the screen less the bar's buttons, 150 pt,
 * and never under 120 pt, as the thread's title always was; the room on
 * each side is beyond that, so the name is cut short where it always was.
 * In the style handed to it, under either layout (the thread draws its
 * title this way under both, as a link).
 */
export function NameTitle({ children, tintColor, style }: { children: string; tintColor?: string; style: TitleStyle }) {
  const { width } = useWindowDimensions();
  return (
    <HeaderTitle tintColor={tintColor} style={[style, { maxWidth: Math.max(120, width - 150) + 2 * (style.paddingHorizontal ?? 0) }]}>
      {children}
    </HeaderTitle>
  );
}

/** A bar's title drawn by NameTitle in the names' face, as the stack hands a title its words and ink. */
function EditorialTitle({ children, tintColor }: { children: string; tintColor?: string }) {
  return (
    <NameTitle tintColor={tintColor} style={nameTitleStyle("editorial")}>
      {children}
    </NameTitle>
  );
}

/**
 * Editorial (Preview): what draws a bar's title that is a username, given
 * the title style handed to the bar: under Editorial NameTitle, which gives
 * the face's letters their room; under Original, and where the bar is
 * titled with other words, nothing, so the bar draws its own title exactly
 * as it always has. Handed to the bar under either layout, since a screen's
 * options are merged into the ones it set before.
 */
export function nameHeaderTitle(style: TitleStyle) {
  return style === nameTitleStyle("editorial") ? EditorialTitle : undefined;
}
