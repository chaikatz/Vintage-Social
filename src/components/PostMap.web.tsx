import React from "react";
import { StyleSheet, View } from "react-native";
import { EmptyState } from "./EmptyState";
import type { GridPost } from "./PhotoGrid";

/** The phone's map's props (src/components/PostMap.tsx), so either can stand where the other does. */
interface Props {
  posts: GridPost[];
  onOpenPost: (post: GridPost) => void;
  header?: React.ReactElement;
}

/**
 * The map is the phone's. The browser review build shows where it goes
 * without pretending to be it: no pins, so nothing here to tap. Places,
 * the next view along, files the same photographs by place on both.
 */
export function PostMap({ header }: Props) {
  return (
    <View style={styles.root}>
      {header}
      <EmptyState title="The map lives on the phone" body="Open VINTAGE on your iPhone to see these photographs on the world." />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
