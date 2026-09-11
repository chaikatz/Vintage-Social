import React from "react";
import { StyleSheet, View } from "react-native";
import { EmptyState } from "./EmptyState";
import type { PostRow } from "@/types/db";

interface Props {
  posts: PostRow[];
  onOpenPost: (post: PostRow) => void;
  header?: React.ReactElement;
}

/**
 * The map is the phone's. The browser review build shows where it goes
 * without pretending to be it.
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
