import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";

/**
 * A small JSON file that outlives the session: one in the app's own
 * folders on the phone, a localStorage key in the browser. Every read and
 * write is best-effort — a cache that fails to save costs a lookup later,
 * never an error now — and the parse is the caller's, so a file from an
 * older build that no longer fits is simply ignored.
 *
 * On the phone a file goes in Documents unless it asks for the cache
 * folder. Documents is kept and backed up with the phone; the cache folder
 * is neither, and iOS may empty it when space runs low. So the cache is
 * for what only makes the app quicker or less repetitive, and would be
 * no loss if it went. The browser has one localStorage either way.
 */
export interface DiskCacheOptions {
  /** "document" (the default) or "cache". Ignored in the browser. */
  dir?: "document" | "cache";
}

function fileFor(file: string, opts?: DiskCacheOptions): File {
  return new File(opts?.dir === "cache" ? Paths.cache : Paths.document, file);
}

export function readDiskCache<T>(
  file: string,
  key: string,
  parse: (raw: unknown) => T | null,
  opts?: DiskCacheOptions,
): T | null {
  try {
    let text: string | null = null;
    if (Platform.OS === "web") {
      text = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } else {
      const f = fileFor(file, opts);
      text = f.exists ? f.textSync() : null;
    }
    if (!text) return null;
    return parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export function writeDiskCache(file: string, key: string, value: unknown, opts?: DiskCacheOptions): void {
  try {
    const raw = JSON.stringify(value);
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, raw);
      return;
    }
    const f = fileFor(file, opts);
    if (!f.exists) f.create();
    f.write(raw);
  } catch {
    // Not worth an error — see above.
  }
}

/** The file gone, not emptied: what is asked to be forgotten leaves no file behind. */
export function deleteDiskCache(file: string, key: string, opts?: DiskCacheOptions): void {
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
      return;
    }
    const f = fileFor(file, opts);
    if (f.exists) f.delete();
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
