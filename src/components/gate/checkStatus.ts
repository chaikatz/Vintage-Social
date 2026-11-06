/**
 * "Check status" in the waiting room: whether the check reached VINTAGE
 * is the profile's read alone, which gives up after a few tries and says
 * so. The applicant's own application is read again alongside, and not
 * waited for: with no signal its further tries wait for one (react-query,
 * src/lib/queryClient.ts), and neither land nor fail until it returns.
 * Waited for, the button spun until the signal came back, and "Couldn't
 * reach VINTAGE just now" could never be said. What the application says
 * still reaches the screen when it lands: the words are drawn from it.
 */
export async function checkStatus(
  readProfile: () => Promise<boolean>,
  readApplication: () => Promise<unknown>,
): Promise<boolean> {
  readApplication().catch(() => undefined);
  return readProfile();
}
