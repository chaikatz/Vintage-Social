import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * vintage://invite/<slug> — and, once the domain is live,
 * https://<domain>/i/<slug> through a universal link.
 *
 * A tapped invitation should land on the card with the suffix already in
 * it, not on a form asking the reader to type something they were just
 * shown. This route exists only to carry that suffix across.
 */
export default function InviteDeepLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={{ pathname: "/(gate)/invite", params: { slug: slug ?? "" } }} />;
}
