import { Redirect, useLocalSearchParams } from "expo-router";

// A page at the door that breaks breaks only itself, not the whole app.
// There is no header and no tab bar here, so the way back is on the page
// (src/navigation/Recover.tsx): to the page before, or to Home, whose
// guard sends anyone not yet let in to the door or the waiting room.
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

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
