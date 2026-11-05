import { DynamicColorIOS, Platform, type ColorValue } from "react-native";

/**
 * The two inks the door is printed in, beyond the app's own tokens: the
 * warm dark of the primary button as it appears on the landing page, and
 * the cream struck on it. On the black page they trade places as white
 * and black, the way the shutter does.
 */
export const GATE_BUTTON: ColorValue =
  Platform.OS === "ios" ? DynamicColorIOS({ light: "#3F3C35", dark: "#FFFFFF" }) : "#3F3C35";
export const GATE_ON_BUTTON: ColorValue =
  Platform.OS === "ios" ? DynamicColorIOS({ light: "#F6F1E8", dark: "#000000" }) : "#F6F1E8";
