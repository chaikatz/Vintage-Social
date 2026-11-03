import { Alert, Platform } from "react-native";

/**
 * Cross-platform dialogs. React Native's Alert is a silent no-op in the
 * browser, so on web these fall back to the native window dialogs — plain,
 * but every confirmation keeps working during browser review. Native
 * behavior is untouched, but for a menu of more buttons than Android's
 * dialog holds (androidMenu).
 */

export interface AlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

/** The most buttons Android's dialog holds. It drops any past them without a word. */
const ANDROID_MOST = 3;

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS === "android" && buttons && buttons.length > ANDROID_MOST) {
    androidMenu(title, message, buttons);
    return;
  }
  if (Platform.OS !== "web") {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = [title, message].filter(Boolean).join("\n\n");
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }

  const cancel = buttons.find((b) => b.style === "cancel");
  // A menu of several (your post's "…": edit, add to an era, delete) asks
  // which, by number, so every one of them can be reached in the browser.
  // The first is written in already, so OK alone does what it always did.
  const actions = buttons.filter((b) => b.style !== "cancel");
  if (actions.length > 1) {
    const list = actions.map((b, i) => `${i + 1}  ${b.text}`).join("\n");
    const answer = window.prompt(`${text}\n\n${list}\n\nType the number of the one you want.`, "1")?.trim() ?? "";
    const chosen = /^\d+$/.test(answer) ? actions[Number(answer) - 1] : undefined;
    if (chosen) chosen.onPress?.();
    else cancel?.onPress?.();
    return;
  }

  const action = actions[0] ?? buttons[0];
  const confirmed = window.confirm(`${text}\n\nOK → ${action.text}`);
  if (confirmed) action.onPress?.();
  else cancel?.onPress?.();
}

/**
 * A menu of more than Android's dialog holds (your post's "…": edit, add
 * to an era, delete, cancel). Left to Android, the last is dropped, and
 * that is Cancel; and its dialog cannot be closed any other way by
 * default, so the member could not leave without choosing one. So the
 * actions are shown alone, and the menu is cancelled as Android cancels a
 * dialog: with Back, or a tap beside it. A destructive one goes first,
 * which Android sets apart on the left, so the button on the right, where
 * a dialog's confirm sits, is never the one that deletes. More actions
 * than the dialog holds, and the last place opens the rest, so none is
 * ever lost.
 */
function androidMenu(title: string, message: string | undefined, buttons: AlertButton[]): void {
  const cancel = buttons.find((b) => b.style === "cancel");
  const actions = buttons.filter((b) => b.style !== "cancel");
  const ordered = [...actions.filter((b) => b.style === "destructive"), ...actions.filter((b) => b.style !== "destructive")];
  const rest = [...ordered.slice(ANDROID_MOST - 1), ...(cancel ? [cancel] : [])];
  const shown =
    ordered.length <= ANDROID_MOST
      ? ordered
      : [...ordered.slice(0, ANDROID_MOST - 1), { text: "More…", onPress: () => androidMenu(title, message, rest) }];
  Alert.alert(title, message, shown, { cancelable: true, onDismiss: cancel?.onPress });
}

export function showPrompt(
  title: string,
  message: string | undefined,
  onSubmit: (value: string) => void,
  fallbackValue?: string,
): void {
  if (Platform.OS === "web") {
    const value = window.prompt([title, message].filter(Boolean).join("\n\n"), fallbackValue);
    if (value && value.trim()) onSubmit(value.trim());
    return;
  }
  if (Platform.OS === "ios") {
    Alert.prompt(title, message, (value) => {
      if (value && value.trim()) onSubmit(value.trim());
    });
    return;
  }
  // Android has no Alert.prompt; confirm sending the provided default text.
  if (!fallbackValue) return;
  Alert.alert(title, `${message ?? ""}\n\n“${fallbackValue}”`.trim(), [
    { text: "Send", onPress: () => onSubmit(fallbackValue) },
    { text: "Cancel", style: "cancel" },
  ]);
}
