// The VINTAGE launch test.
//
// Two phases, for a reason. Everything that depends on state accumulating
// — an application being submitted and then found in the queue, a
// nomination being minted and then redeemed — has to happen in one
// uninterrupted session, navigated by tapping, because demo state lives in
// the page and a reload would wipe it. Everything else is checked from a
// direct URL, which is steadier than fighting a stack that keeps every
// screen mounted.
import { chromium } from "playwright";
const out = process.env.SHOT_DIR;
const B = "http://127.0.0.1:8090";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const errors = [];
// A Chromium built without H.264 refuses a demo video's play() ("no
// supported source"). That is the browser, not the app; which feed rows
// render — and so whether a video is among them — depends on the time of
// day the demo is seeded at. Forgiven only when the browser really cannot
// play H.264, so a broken video address still fails the test elsewhere.
let noH264 = false;
page.on("pageerror", (e) => {
  if (noH264 && /no supported source/.test(e.message)) return;
  errors.push(e.message);
});
noH264 = await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') === "");
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) {
    errors.push("console: " + m.text());
  }
});
// showAlert falls back to window.confirm on web; Playwright dismisses
// dialogs unless told otherwise, which would silently cancel every
// confirmation the test gives. A prompt (an era's new name) is answered
// with `promptAnswer` while one is set. A menu of several (a post's "…")
// asks for the number of one: `promptChoice` names the one to take, and
// without it the menu is left as it was. Every dialog's words are kept.
let promptAnswer = null;
let promptChoice = null;
const dialogs = [];
page.on("dialog", (d) => {
  dialogs.push(d.message());
  if (d.type() === "prompt" && promptChoice != null) {
    const line = d.message().split("\n").find((l) => l.trim().endsWith(promptChoice));
    return d.accept(line?.trim().match(/^\d+/)?.[0] ?? "");
  }
  return d.type() === "prompt" && promptAnswer != null ? d.accept(promptAnswer) : d.accept();
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const wait = (ms) => page.waitForTimeout(ms);
const text = () => page.textContent("body");
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const seen = (l) => l.locator("visible=true");
const byText = (t) => seen(page.getByText(t, { exact: true }));
const byLabel = (t) => seen(page.getByLabel(t, { exact: true }));
const tap = async (label, ms = 1900) => {
  await byText(label).first().click();
  await wait(ms);
};
const fields = () => seen(page.locator("input:not([type=checkbox]), textarea"));
const go = async (path, ms = 2400) => {
  await page.goto(B + path, { waitUntil: "networkidle" });
  await wait(ms);
};
// The tab bar is a pager: every page stays mounted, inactive ones parked
// off-screen, so a tap has to be confirmed by aria-selected before the page
// behind it can be trusted.
const TAB = { home: 0, search: 1, post: 2, activity: 3, profile: 4 };
// Pushed screens (admin, settings, a thread) cover the tab bar; unwind
// until it is back on screen before reaching for a tab.
const toTabs = async () => {
  for (let i = 0; i < 6; i++) {
    if (await seen(page.locator('[role="tab"]')).count()) return;
    await page.goBack();
    await wait(1300);
  }
};
const tab = async (which, ms = 2400) => {
  await toTabs();
  const i = TAB[which];
  await seen(page.locator('[role="tab"]')).nth(i).click();
  await page
    .waitForFunction(
      (n) => document.querySelectorAll('[role="tab"]')[n]?.getAttribute("aria-selected") === "true",
      i,
      { timeout: 10000 },
    )
    .catch(() => {});
  await wait(ms);
};
const back = async (ms = 1900) => {
  await page.goBack();
  await wait(ms);
};
async function signOutFromSettings() {
  await tab("profile");
  await byLabel("Settings").first().click();
  await wait(2200);
  await tap("Sign out", 2900);
}

async function signInAs(email) {
  await tap("Sign in", 1800);
  await fields().nth(0).fill(email);
  await fields().nth(1).fill("vintage-demo");
  await byText("Sign in").last().click();
  await wait(3000);
}

// ===========================================================================
// PHASE A — the membership chain, in one continuous session
// ===========================================================================
await go("/", 1600);
check("Landing reads as a closed door", /Members only/.test(await text()));
await shot("01-landing");

// 1. application
await tap("Apply for membership", 2100);
const f = fields();
await f.nth(0).fill("Wren Alcott");
await f.nth(1).fill("wren.alcott");
await f.nth(2).fill("wren@example.com");
await f.nth(3).fill("vintage-demo");
await f.nth(4).fill("@wrenshoots");
await f.nth(5).fill("Edinburgh");
await f.nth(7).fill("I shoot on a Rollei my father left me, mostly harbours and weather. I would like a smaller room to show them in.");
await shot("02-application");
await tap("Submit application", 2900);
const pendingText = await text();
check("Application lands on the waitlist screen", /Application received/i.test(pendingText));
check("Applicant carries no membership number", !/NO\. \d{5}/.test(pendingText));
await shot("03-pending");

// 2. the founder approves
await tap("Sign out", 2600);
check("Signing out from the waitlist reaches the door", /Members only/.test(await text()));
await signInAs("admin@vintage.club");
await tab("profile");
await byLabel("Admin").first().click();
await wait(2300);
await tap("Applications", 2600);
const queue = await text();
check("Application reaches the admin queue", /wren\.alcott/.test(queue));
check("Queue shows who invited an applicant", /invited by/.test(queue));
await shot("04-admin-queue");

// The queue is oldest first, so the application just submitted is last.
const approvals = byText("Approve");
await approvals.nth((await approvals.count()) - 1).click();
await wait(2900);
check("Approval removes it from the pending queue", !/wren\.alcott/.test(await text()));

await back();
await tap("Members", 2600);
const members = await text();
check("Members list shows membership numbers", /NO\. \d{5}/.test(members));
check("Newly approved member is numbered", /wren\.alcott/.test(members));
check("Suspension control available", /Suspend/.test(members));
await shot("05-admin-members");

await back();
await tap("Reports", 2500);
check("Moderation queue holds the open report", /Promotional|engagement/i.test(await text()));
await shot("06-reports");

// 3. a member's invitation
await back();
await signOutFromSettings();
await signInAs("elena@vintage.club");
await tab("profile");
await tap("Invitations", 2600);
const nom = await text();
check("Framed as an invitation with an allowance", /invitations? left · \d+ of \d+ taken up|Every invitation you were given/.test(nom));
// The code is the ending of the member's link: shown on its own line under "Copy invitation code".
const codes = (await text()).match(/vintage:\/\/invite\/([a-z0-9-]+)|\/i\/([a-z0-9-]+)/);
const code = codes?.[1] ?? codes?.[2] ?? "";
check("An invitation code is shown", code.length > 0, code || "none");
await shot("07-invitations");

// 4. the invitation is taken up
await back();
await signOutFromSettings();
await tap("I have an invitation", 2500);
check("Invitation screen is framed as an invitation", /By invitation/.test(await text()));
const g = fields();
await g.nth(0).fill(code);
await g.nth(1).fill("Ada Fen");
await g.nth(2).fill("ada.fen");
await g.nth(3).fill("ada@example.com");
await g.nth(4).fill("vintage-demo");
await shot("08-nomination-card");
await tap("Accept the invitation", 4200);
// Assert positively that the feed is showing. The gate screens stay
// mounted underneath, so their text is still in the DOM and its absence
// proves nothing.
const admitted = await text();
check(
  "Redeemed invitation admits straight to the feed",
  /elena\.marchetti|june\.nakamura|sam\.okafor/.test(admitted) && !/Application received/i.test(admitted),
);
await shot("09-admitted");

await tab("profile", 2800);
const newMember = await text();
check("New member is numbered on entry", /NO\. \d{5}/.test(newMember));
check("New member reads as a member", /MEMBER · NO\. \d{5}/.test(newMember));
await shot("10-new-member");

// ===========================================================================
// PHASE B — the day-to-day product, from a signed-in member
// ===========================================================================
await go("/", 1600);
await signInAs("elena@vintage.club");
const feed = await text();
check("Chronological feed renders", /elena\.marchetti|tomas\.lindqvist/.test(feed));
check("Feed shows film stock and place", /Chrome 64|Alpine|Archive/i.test(feed));
check("Comment previews read under the caption", /forgives everything|emptiness makes it/.test(feed));
await shot("11-feed");

await byLabel("Like").first().click();
await wait(1500);
check("Like registers", /\d+ likes?/.test(await text()));

await byLabel("Comments").first().click();
await wait(2500);
check("Comments open without repeating the photograph", /Add a comment/.test(
  (await page.locator("textarea, input").last().getAttribute("placeholder")) ?? "",
));
await fields().last().fill("The light that morning was doing all the work.");
await tap("Post", 2100);
check("Comment posts into the thread", /doing all the work/.test(await text()));
await shot("12-comments");

await go("/user/tomas.lindqvist", 2800);
const tomas = await text();
check("Profile shows MEMBER and number", /MEMBER · NO\. \d{5}/.test(tomas));
await shot("13-profile-founding");
const follow = () => seen(page.getByText(/^(Follow|Following|Requested)$/)).first();
const before = await follow().textContent();
await follow().click();
await wait(2300);
check("Follow changes state", (await follow().textContent()) !== before, `${before} → …`);

// Eras, between Timeline and Map: the demo's three Stockholm photographs
// of Tomas's were taken within ten days, so they always make an era.
await go("/user/tomas.lindqvist", 2800);
await tap("Eras", 2000);
const eras = await text();
check("Eras gathers a member's photographs by place and year", /Stockholm \d{4}/.test(eras));
check("An era says how many photographs it holds", /\d+ photographs/i.test(eras));
await shot("13b-eras");
await seen(page.getByLabel(/^(Photograph|Film), /)).first().click();
await wait(2600);
// All of Tomas's photographs are in the era, so the cards are the same
// either way: what tells is the gallery's title, which is the era's only
// once the gallery has found the era again. The eras behind it still hold
// those words, out of sight, so only a heading in view counts.
const eraTitle = await seen(page.getByRole("heading", { name: /^Stockholm \d{4}$/ })).count();
check(
  "An era's print opens the gallery, held to that era",
  /\/gallery\?.*era=Stockholm/.test(page.url()) &&
    eraTitle > 0 &&
    /Last ferry|a mirror today|opened for the season/.test(await text()),
  page.url(),
);
await shot("13c-era-gallery");

// Eras the member arranges, on their own page only: EDIT, rename an era,
// move a photograph into it, DONE. Two of the demo's Milan photographs of
// Elena's were taken in January 2025, so she has two Milan eras. All of
// it in one visit, by tapping: the demo keeps the arrangement in the page.
await go("/profile", 2800);
await tap("Eras", 2000);
await byLabel("Edit eras").first().click();
await wait(900);
check("Your own Eras opens for arranging", /Arranging/.test(await text()) && (await byLabel("Rename Milan 2025").count()) > 0);
promptAnswer = "The foggy winter";
await byLabel("Rename Milan 2025").first().click();
await wait(1200);
promptAnswer = null;
const heading = (name) => seen(page.getByRole("heading", { name })).count();
check("An era takes the name its member gives it", (await heading(/^The foggy winter, 2 photographs$/)) > 0);
await seen(page.getByLabel(/^Photograph, .*The 19 tram/)).first().click();
await wait(1200);
const sheet = seen(page.getByTestId("era-move-sheet"));
check("A print, tapped while arranging, asks which era it belongs in", (await sheet.count()) > 0 && /Move to/i.test(await sheet.first().textContent()));
await shot("13d-era-move");
await seen(page.getByRole("button", { name: /^The foggy winter, 2 photographs/ })).first().click();
await wait(900);
check(
  "The photograph moves into the era chosen, and the page says so",
  (await heading(/^The foggy winter, 3 photographs$/)) > 0 && /Moved to The foggy winter/i.test(await text()),
);
await byLabel("Done arranging eras").first().click();
await wait(900);
check(
  "DONE leaves the eras as arranged, and EDIT to open them again",
  (await byLabel("Edit eras").count()) > 0 && (await heading(/^The foggy winter, 3 photographs$/)) > 0,
);
await shot("13e-eras-arranged");

// ADD, NEW ERA, "New era…", taking a photograph out and deleting an era
// of her own, all in the same visit. The foggy winter holds the tram and
// both of January's; Milan 2026 is left with the courtyard.
await byLabel("Edit eras").first().click();
await wait(900);
check(
  "Arranging offers ADD on every era, and NEW ERA in the bar",
  (await byLabel("Add to The foggy winter").count()) > 0 &&
    (await byLabel("Add to Milan 2026").count()) > 0 &&
    (await byLabel("New era").count()) > 0,
);
await shot("13f-eras-add-new");
const gather = () => seen(page.getByTestId("era-gather-sheet")).first();
const confirmOff = async () => (await gather().getByTestId("era-gather-confirm").getAttribute("aria-disabled")) === "true";
const pick = (caption) => seen(gather().getByRole("checkbox", { name: caption })).first();
await byLabel("Add to Milan 2026").first().click();
await wait(1200);
check(
  "ADD lists the photographs in other eras by era, and adds nothing until one is chosen",
  /Add to Milan 2026/i.test(await gather().textContent()) &&
    (await seen(gather().getByRole("heading", { name: "The foggy winter" })).count()) > 0 &&
    (await confirmOff()),
);
await pick(/Fog on the Naviglio/).click();
await wait(500);
check("Choosing a photograph offers to add it, by count", !(await confirmOff()) && /Add 1/.test(await gather().textContent()));
await shot("13g-era-add-sheet");
await gather().getByTestId("era-gather-confirm").click();
await wait(900);
check(
  "ADD brings a photograph over from another era, and the page says so",
  (await heading(/^Milan 2026, 2 photographs$/)) > 0 &&
    (await heading(/^The foggy winter, 2 photographs$/)) > 0 &&
    /Added 1 to Milan 2026/i.test(await text()),
);

await byLabel("New era").first().click();
await wait(1200);
check("NEW ERA asks for a name and photographs, and makes nothing before both", /New era/i.test(await gather().textContent()) && (await confirmOff()));
await seen(gather().getByTestId("era-name")).first().fill("Saturdays");
await wait(300);
const namedOnly = await confirmOff();
await pick(/Saturday market/).click();
await wait(500);
check("A name and a photograph make it possible", namedOnly && !(await confirmOff()));
await shot("13h-era-new-sheet");
await gather().getByTestId("era-gather-confirm").click();
await wait(900);
check(
  "A new era takes its place on the page, with its photograph",
  (await heading(/^Saturdays, 1 photograph$/)) > 0 && (await heading(/^The foggy winter, 1 photograph$/)) > 0 && /Made Saturdays/i.test(await text()),
);

const moveSheet = () => seen(page.getByTestId("era-move-sheet")).first();
await seen(page.getByLabel(/^Photograph, .*The 19 tram/)).first().click();
await wait(1200);
check(
  "Move to offers a new era, and the way out of the era a move put it in",
  (await moveSheet().getByRole("button", { name: "New era" }).count()) > 0 &&
    (await moveSheet().getByRole("button", { name: /^Take out of The foggy winter\. Back to Milan 2026\.$/ }).count()) > 0,
);
await shot("13i-era-move-new");
await moveSheet().getByRole("button", { name: "New era" }).click();
await wait(1200);
check("New era… turns the sheet to a new era with the photograph already chosen", (await pick(/The 19 tram/).getAttribute("aria-checked")) === "true");
await seen(gather().getByTestId("era-name")).first().fill("Early trams");
await gather().getByTestId("era-gather-confirm").click();
await wait(900);
check("The new era is made with it", (await heading(/^Early trams, 1 photograph$/)) > 0 && /Made Early trams/i.test(await text()));

await seen(page.getByLabel(/^Photograph, .*The 19 tram/)).first().click();
await wait(1200);
await moveSheet().getByRole("button", { name: /^Take out of Early trams/ }).click();
await wait(900);
check(
  "Taken out, a photograph goes back where it came from, and an era of the member's own goes with its last",
  (await heading(/^Milan 2026, 3 photographs$/)) > 0 && (await heading(/^Early trams/)) === 0 && /Back in Milan 2026/i.test(await text()),
);

promptAnswer = "";
await byLabel("Rename Saturdays").first().click();
await wait(1200);
promptAnswer = null;
check(
  "An era of the member's own is deleted from its name, asked once more, and its photograph goes back",
  dialogs.some((m) => /Leave it empty to delete it/.test(m)) &&
    dialogs.some((m) => /^Delete “Saturdays”\?/.test(m)) &&
    (await heading(/^Saturdays/)) === 0 &&
    (await heading(/^The foggy winter, 1 photograph$/)) > 0,
);
await byLabel("Done arranging eras").first().click();
await wait(900);

// From the feed: the "…" on her own photograph adds it to an era; on
// another member's, it never does. Tapped, so the arrangement stays.
await tab("home");
const cardOf = (caption) =>
  seen(page.locator("div").filter({ hasText: caption }).filter({ has: page.getByLabel("Post options", { exact: true }) })).last();
await cardOf("Last ferry of the evening").getByLabel("Post options", { exact: true }).first().click();
await wait(900);
const theirs = dialogs.at(-1) ?? "";
check("Another member's post offers no era", /Report post/.test(theirs) && !/Add to an era/.test(theirs));
await cardOf("The 19 tram").scrollIntoViewIfNeeded();
await shot("13j-feed-own-post");
promptChoice = "Add to an era…";
await cardOf("The 19 tram").getByLabel("Post options", { exact: true }).first().click();
await wait(2200);
promptChoice = null;
check(
  "Your own post's options add it to an era, in the sheet the Eras page uses",
  /Add to an era…/.test(dialogs.at(-1) ?? "") &&
    /\/era-move\?postId=/.test(page.url()) &&
    /Move to/i.test(await moveSheet().textContent()) &&
    (await moveSheet().getByRole("button", { name: "New era" }).count()) > 0,
);
await shot("13j-feed-add-to-era-sheet");
await moveSheet().getByRole("button", { name: /^The foggy winter, 1 photograph/ }).click();
await wait(1600);
// The web lays the tabs out afresh under a screen pushed over them, as it does after Edit caption.
await tab("profile");
await tap("Eras", 2000);
check(
  "Your Eras show the change made from the feed",
  !/\/era-move/.test(page.url()) && (await heading(/^The foggy winter, 2 photographs$/)) > 0 && (await heading(/^Milan 2026, 2 photographs$/)) > 0,
);
await shot("13k-eras-after-feed");

// A member's own name for their era, on their page, where it cannot be changed.
await go("/user/niko.papadakis", 2800);
await tap("Eras", 2000);
check(
  "A member's Eras show the names they gave them, with nothing to edit",
  (await heading(/^Islands, off-season, \d+ photographs$/)) > 0 && (await byLabel("Edit eras").count()) === 0,
);

await go("/user/otis.whitfield", 2800);
check("Private account is gated", /This account is private/.test(await text()));
await shot("14-private");

await go("/search", 2800);
check("Explore grid populated", (await page.locator("img").count()) > 6);
await shot("15-explore");

await go("/messages", 2600);
check("Messages inbox renders", /tomas|june|arthur/i.test(await text()));
await shot("16-messages");

// posting: filter, place, date stamp
await go("/compose?" + new URLSearchParams({
  uri: B + "/sample.jpg", mediaType: "photo", width: "1200", height: "1500", duration: "0",
  takenAt: "2026-06-14T18:22:00.000Z",
}).toString(), 3200);
const compose = await text();
check("Filter tray offers the full set", /Archive/.test(compose) && /Postcard/.test(compose));
check("Date stamp offered on every filter", /Date stamp/.test(compose));
await tap("Cassette", 1500);
// The place is chosen in a sheet: open it from the "Where" row, type, take the words.
await byLabel("Choose a place").first().click();
await wait(1200);
const where = seen(page.getByPlaceholder(/a town, a street|a restaurant, a hotel/i)).first();
await where.fill("Leith");
await where.press("Enter");
await wait(1200);
await shot("17-compose");
await tap("Share to VINTAGE", 4600);
const afterPost = await text();
check("Post publishes into the feed", /Leith/.test(afterPost));
check("Stamp reads the capture date, not today", /6 14/.test(afterPost));
await shot("18-posted");

console.log("\nJS errors:", errors.length ? errors.slice(0, 10) : "none");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log("FAILED: " + failed.map((r) => r.name).join(" | "));
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
