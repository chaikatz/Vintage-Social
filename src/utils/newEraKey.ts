import { getRandomBytes } from "expo-crypto";
import { ERA_KEY_BYTES, eraKeyFrom } from "./eraEdits";

/** Draws enough for a key all but every time; a source that never does is broken, and is said to be. */
const DRAWS = 8;

/**
 * The key of a new era of the member's own ("~" and ten letters and
 * digits), from the phone's secure random source. It is not a secret,
 * only never the same as another of theirs: there are 36¹⁰ keys, some
 * three and a half thousand million million, and createEra refuses one
 * already in use besides.
 *
 * Kept apart from eraEdits.ts, which node reads in the tests, as this
 * reaches into the phone's own code.
 */
export function newEraKey(): string {
  for (let draw = 0; draw < DRAWS; draw++) {
    const key = eraKeyFrom(getRandomBytes(ERA_KEY_BYTES));
    if (key) return key;
  }
  throw new Error("There was no randomness to make an era’s key from.");
}
