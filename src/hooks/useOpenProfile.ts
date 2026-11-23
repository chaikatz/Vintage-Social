import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useNavigation, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import { useSession } from "@/providers/SessionProvider";
import { profileStep, type RouteLike } from "@/utils/profileStep";

/**
 * Opens a member's page from their name, wherever the name is drawn: a
 * comment, a caption, an @name, a notice. The same function for the
 * screen's whole life, so the rows it is handed to are not drawn again.
 *
 * Never a second copy of a page already open (src/utils/profileStep.ts):
 * on the page it names it stays, and one screen above it it goes back.
 */
export function useOpenProfile(): (username: string) => void {
  const router = useRouter();
  const navigation = useNavigation();
  const { profile } = useSession();
  const me = profile?.username ?? null;
  return useCallback(
    (username: string) => {
      const target = username.trim().toLowerCase();
      if (!target) return;
      // The stack every member's page is laid on (app/_layout.tsx): this
      // screen's own navigator, or for a tab, the one the tabs are in.
      let stack: NavigationProp<ParamListBase> | undefined = navigation as NavigationProp<ParamListBase>;
      while (stack && stack.getState()?.type !== "stack") stack = stack.getParent();
      const state = stack?.getState();
      const step = state ? profileStep(state.routes as readonly RouteLike[], state.index, target, me) : "push";
      if (step === "stay") return;
      if (step === "back") router.back();
      else router.push(`/user/${target}`);
    },
    [navigation, router, me],
  );
}
