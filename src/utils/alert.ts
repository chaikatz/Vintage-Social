import { Alert, Platform } from "react-native";

/**
 * Cross-platform dialogs. React Native's Alert is a silent no-op in the
 * browser, so on web these fall back to the native window dialogs — plain,
 * but every confirmation keeps working during browser review. Native
 * behavior is untouched.
 */

export interface AlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
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
