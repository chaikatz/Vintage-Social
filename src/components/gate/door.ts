/**
 * The door's two ways out, as plain rules (useDoor has the hook).
 *
 * Signed in, nobody belongs on the invitation card. Joining makes the
 * account first and takes up the invitation second, so a refusal of the
 * second (the last place taken, a dropped connection) left the new member
 * signed in on the card, where every further try was "User already
 * registered". And a member who opened an invitation link while signed in
 * could make a second account over the first, without the sign-out that
 * clears the first one's things from the phone. So once there is a
 * session, and nothing is being sent, the card goes in, once: the root
 * then says where this member belongs, the app or the waiting room, whose
 * "I have an invitation" takes the code with the account already made.
 */
export function shouldGoIn(signedIn: boolean, busy: boolean, gone: boolean): boolean {
  return signedIn && !busy && !gone;
}

/** What the back mark needs of the router. */
export interface DoorRouter {
  canGoBack(): boolean;
  back(): void;
  replace(href: "/"): void;
}

/**
 * The back mark at the door: the screen before, or, when the card is the
 * first screen there is (the app opened by a tapped invitation), the root,
 * which knows where the visitor belongs. `back()` with nothing behind it
 * did nothing, and the card had no way off it.
 */
export function backFromDoor(router: DoorRouter): void {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
