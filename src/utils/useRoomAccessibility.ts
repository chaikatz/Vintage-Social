import { AccessibilityInfo, Platform } from "react-native";
import { accessibilitySetting, useAccessibilitySetting } from "./useReducedMotion";

/**
 * The rest of what the Darkroom follows from iOS Settings › Accessibility,
 * besides Reduce Motion: Increase Contrast, Bold Text and VoiceOver. The
 * room is always printed on the dark page, whatever the appearance, so it
 * cannot leave these to the system colours the way the rest of the app
 * does; each one is read here and applied by the room itself.
 *
 * Each reads the current value when first wanted and follows its change
 * event until no screen wants it (see `useReducedMotion.ts`). Away from
 * iOS, a setting the platform cannot report reads as off.
 */

/**
 * Increase Contrast ("darker system colours"). Where it is on, the room's
 * faint text is set in its soft ink, its rules are drawn at full strength,
 * and the well's hairline takes the strong line.
 */
export const increaseContrast = accessibilitySetting(
  () => AccessibilityInfo.isDarkerSystemColorsEnabled?.(),
  "darkerSystemColorsChanged",
);

/** Bold Text. Where it is on, the room's type is set bold; Courier New and Georgia both have bold faces on iOS. */
export const boldText = accessibilitySetting(() => AccessibilityInfo.isBoldTextEnabled?.(), "boldTextChanged");

/**
 * VoiceOver, or another screen reader. React Native for the web answers
 * yes to this every time, because a page cannot tell; the browser review
 * build is a phone with VoiceOver off, so there it reads as off.
 */
export const screenReader = accessibilitySetting(
  () => (Platform.OS === "web" ? Promise.resolve(false) : AccessibilityInfo.isScreenReaderEnabled()),
  "screenReaderChanged",
);

export function useIncreaseContrast(): boolean {
  return useAccessibilitySetting(increaseContrast);
}

export function useBoldText(): boolean {
  return useAccessibilitySetting(boldText);
}

/** While a screen reader is running the room's chrome never hides. */
export function useScreenReader(): boolean {
  return useAccessibilitySetting(screenReader);
}
