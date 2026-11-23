import React, { memo, useCallback, useEffect, useRef } from "react";
import { Animated, Easing, FlatList, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing } from "@/theme";
import type { PlaceSheetView } from "@/utils/mapPlace";
import { GRID_GAP, GRID_SCREENS, PhotoTile, type GridPost } from "./PhotoGrid";
import { PlaceHead } from "./PlaceGroups";

/** Squares to a row, as on the grid. */
const ACROSS = 3;
/** The map left showing above the sheet, so it is plainly a sheet over the map: a tap there puts it away. */
export const SHEET_GAP = 44;

interface Props {
  sheet: PlaceSheetView<GridPost>;
  onOpenPost: (post: GridPost) => void;
  onClose: () => void;
}

/**
 * The photographs at one place on a profile's map, over the map: the
 * place's name as Places heads it, the years, the other names its
 * photographs carry, and every photograph in the grid's squares. Each
 * opens as the profile's grid opens it (the screen decides, through
 * `onOpenPost`). The sheet stays where it is while the photograph is
 * open, so coming back finds it as it was left; the cross, or a tap on
 * the map above it, puts it away.
 *
 * Drawn in the map's own space rather than as a modal: the photograph a
 * square opens is pushed at once, with nothing to put away first, and
 * the way back is the way it came.
 */
export const PlaceSheet = memo(function PlaceSheet({ sheet, onOpenPost, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const size = (width - GRID_GAP * (ACROSS - 1)) / ACROSS;

  // It rises into place once, when it opens; a place swapped for another keeps it where it is.
  const rise = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(rise, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [rise]);
  const lift = rise.interpolate({ inputRange: [0, 1], outputRange: [0, height] });

  // The same press for every square, whatever the map hands down.
  const latestOpen = useRef(onOpenPost);
  latestOpen.current = onOpenPost;
  const open = useCallback((post: GridPost) => latestOpen.current(post), []);
  const renderTile = useCallback(({ item }: { item: GridPost }) => <SheetTile post={item} size={size} onOpen={open} />, [size, open]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        style={styles.above}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Back to the map"
      />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: lift }] }]}>
        <View style={styles.bar}>
          <View style={styles.grabber} />
          <Pressable
            style={styles.close}
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Feather name="x" size={18} color={colors.inkSoft} />
          </Pressable>
        </View>
        <FlatList
          data={sheet.posts}
          keyExtractor={tileKey}
          numColumns={ACROSS}
          renderItem={renderTile}
          ListHeaderComponent={
            <View accessibilityRole="header">
              <PlaceHead title={sheet.title} placed count={sheet.count} meta={sheet.meta} spots={sheet.spots} />
            </View>
          }
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.content}
          // Three screens of squares either side of the reader, as the grid draws.
          windowSize={GRID_SCREENS}
          // Rows, not squares: enough to fill the sheet as it rises.
          initialNumToRender={4}
        />
      </Animated.View>
    </View>
  );
});

function tileKey(post: GridPost): string {
  return post.id;
}

/** One square. Drawn again only when its photograph or its size changes. */
const SheetTile = memo(function SheetTile({ post, size, onOpen }: { post: GridPost; size: number; onOpen: (post: GridPost) => void }) {
  return <PhotoTile post={post} size={size} onPress={() => onOpen(post)} />;
});

const styles = StyleSheet.create({
  above: { position: "absolute", top: 0, left: 0, right: 0, height: SHEET_GAP },
  sheet: {
    position: "absolute",
    top: SHEET_GAP,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.paper,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
    overflow: "hidden",
  },
  bar: { height: 22, alignItems: "center", justifyContent: "center" },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  close: { position: "absolute", right: spacing.lg, top: spacing.sm },
  content: { gap: GRID_GAP, paddingBottom: spacing.xl * 2 },
  row: { gap: GRID_GAP },
});
