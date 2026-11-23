import { useLayoutEffect, useState } from "react";
import { Dimensions, Keyboard, LayoutAnimation, Platform, type KeyboardEvent } from "react-native";
import { keyboardLift } from "@/components/eraSheet";

/**
 * How far the keyboard is up over a sheet that reaches the foot of the
 * window (a page sheet on an iPhone), on iOS; nothing elsewhere. Moves as
 * the keyboard does, in its time, as KeyboardAvoidingView moves a page.
 *
 * KeyboardAvoidingView measures a sheet from the sheet's own top, which is
 * lower than the window's, and leaves its foot that much under the
 * keyboard (src/components/eraSheet.ts, keyboardLift). Listened for as the
 * sheet is laid out, before a field's autoFocus can bring the keyboard up.
 * The Eras sheet keeps its own copy of this (src/components/EraGather.tsx).
 */
export function useSheetKeyboardLift(): number {
  const [lift, setLift] = useState(0);
  useLayoutEffect(() => {
    if (Platform.OS !== "ios") return;
    const move = (e: KeyboardEvent, to: number) => {
      if (e.duration > 0) {
        const duration = Math.max(e.duration, 10);
        LayoutAnimation.configureNext({ duration, update: { duration, type: e.easing } });
      }
      setLift(to);
    };
    const shown = Keyboard.addListener("keyboardWillShow", (e) =>
      move(e, keyboardLift(e.endCoordinates.screenY, Dimensions.get("window").height)),
    );
    const hidden = Keyboard.addListener("keyboardWillHide", (e) => move(e, 0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return lift;
}
