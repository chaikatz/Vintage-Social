import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";

/**
 * A small JSON file that outlives the session: one in the app's documents
 * folder on the phone, a localStorage key in the browser. Every read and
 * write is best-effort — a cache that fails to save costs a lookup later,
 * never an error now — and the parse is the caller's, so a file from an
 * older build that no longer fits is simply ignored.
 */
export function readDiskCache<T>(file: string, key: string, parse: (raw: unknown) => T | null): T | null {
  try {
    let text: string | null = null;
    if (Platform.OS === "web") {
      text = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } else {
      const f = new File(Paths.document, file);
      text = f.exists ? f.textSync() : null;
    }
    if (!text) return null;
    return parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export function writeDiskCache(file: string, key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, raw);
      return;
    }
    const f = new File(Paths.document, file);
    if (!f.exists) f.create();
    f.write(raw);
  } catch {
    // Not worth an error — see above.
  }
}

/** Write at most once a second, however often it is asked. */
export function makeLazyWriter(write: () => void, delayMs = 1000): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      write();
    }, delayMs);
  };
}
