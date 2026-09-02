/**
 * Storage keys.
 *
 * Every VINTAGE bucket namespaces objects by the uploader's id, and every
 * storage policy enforces it by comparing the first path segment against
 * auth.uid(). Building those keys in one place keeps the client honest
 * about the shape the database insists on.
 */

/** The key for a file belonging to `userId`: `{userId}/{filename}`. */
export function ownedPath(userId: string, filename: string): string {
  return `${userId}/${filename}`;
}

/** The owner id a storage key claims, or null if it names no folder. This is
 * what `(storage.foldername(name))[1]` reads on the database side. */
export function pathOwner(path: string): string | null {
  const segments = path.split("/");
  return segments.length > 1 && segments[0] !== "" ? segments[0] : null;
}
