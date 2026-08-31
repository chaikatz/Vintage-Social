import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import type {
  MaterialTopTabNavigationEventMap,
  MaterialTopTabNavigationOptions,
} from "@react-navigation/material-top-tabs";
import type { ParamListBase, TabNavigationState } from "@react-navigation/native";
import { withLayoutContext } from "expo-router";

/**
 * The tab bar, as a swipeable pager.
 *
 * expo-router ships a bottom-tab navigator that cannot be swiped, so the
 * material top-tab navigator is used instead and pinned to the bottom of
 * the screen. Everything else — file-based routes, `<Link>`, `router.push`
 * — keeps working, because `withLayoutContext` hands expo-router the same
 * navigator API it expects.
 */
const { Navigator } = createMaterialTopTabNavigator();

export const SwipeTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof Navigator,
  TabNavigationState<ParamListBase>,
  MaterialTopTabNavigationEventMap
>(Navigator);
