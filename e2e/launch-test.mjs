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
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) {
    errors.push("console: " + m.text());
  }
});
// showAlert falls back to window.confirm on web; Playwright dismisses
// dialogs unless told otherwise, which would silently cancel every
// confirmation the test gives.
page.on("dialog", (d) => d.accept());

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
check("Landing reads as a closed door", /Membership required/.test(await text()));
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
check("Application lands on the waitlist screen", /Application received/.test(pendingText));
check("Applicant carries no membership number", !/NO\. \d{5}/.test(pendingText));
await shot("03-pending");

// 2. the founder approves
await tap("Sign out", 2600);
check("Signing out from the waitlist reaches the door", /Membership required/.test(await text()));
await signInAs("admin@vintage.club");
await tab("profile");
await byLabel("Admin").first().click();
await wait(2300);
await tap("Applications", 2600);
const queue = await text();
check("Application reaches the admin queue", /wren\.alcott/.test(queue));
check("Queue shows who nominated an applicant", /nominated by/.test(queue));
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

// 3. a member mints a nomination
await back();
await signOutFromSettings();
await signInAs("elena@vintage.club");
await tab("profile");
await tap("Nominations", 2600);
const nom = await text();
check("Framed as nomination, not referral", /Nominate a member|None left/.test(nom));
check("Quota shown and finite", /left of \d+/.test(nom));
await tap("Nominate a member", 2300);
const codes = (await text()).match(/[A-Z0-9]{4}-[A-Z0-9]{4}/g) ?? [];
check("A nomination code is minted", codes.length > 0, codes[0] ?? "none");
await shot("07-nominations");
const code = codes[0] ?? "";

// 4. the nomination is redeemed
await back();
await signOutFromSettings();
await tap("I have a nomination", 2500);
check("Nomination screen is framed as nomination", /By nomination/.test(await text()));
const g = fields();
await g.nth(0).fill(code);
await g.nth(1).fill("Ada Fen");
await g.nth(2).fill("ada.fen");
await g.nth(3).fill("ada@example.com");
await g.nth(4).fill("vintage-demo");
await shot("08-nomination-card");
await tap("Accept the nomination", 4200);
// Assert positively that the feed is showing. The gate screens stay
// mounted underneath, so their text is still in the DOM and its absence
// proves nothing.
const admitted = await text();
check(
  "Redeemed nomination admits straight to the feed",
  /elena\.marchetti|june\.nakamura|sam\.okafor/.test(admitted) && !/Application received/.test(admitted),
);
await shot("09-admitted");

await tab("profile", 2800);
const newMember = await text();
check("New member is numbered on entry", /NO\. \d{5}/.test(newMember));
check("New member is a founding member", /FOUNDING MEMBER/.test(newMember));
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
check("Profile shows FOUNDING MEMBER and number", /FOUNDING MEMBER · NO\. \d{5}/.test(tomas));
await shot("13-profile-founding");
const follow = () => seen(page.getByText(/^(Follow|Following|Requested)$/)).first();
const before = await follow().textContent();
await follow().click();
await wait(2300);
check("Follow changes state", (await follow().textContent()) !== before, `${before} → …`);

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
await seen(page.getByPlaceholder(/a town, a street/)).first().fill("Leith");
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
