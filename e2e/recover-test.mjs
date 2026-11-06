// The recover pages, seen in the browser.
//
// A page that throws while it is drawn must not take the app with it. This
// breaks a page on purpose (a date that will not be read, as a row from
// the server that is missing a field would) and checks what the member
// sees: the app's own recover page, never a blank page and never the
// runtime's words, and that "Try again" brings the page back once the
// cause has gone. Run it as the launch test is run (see e2e/README.md),
// with `node e2e/recover-test.mjs` against a served demo build.
import { chromium } from "playwright";
const out = process.env.SHOT_DIR;
const B = "http://127.0.0.1:8090";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// Uncaught: what reaches the window, which is what a boundary stops.
const uncaught = [];
page.on("pageerror", (e) => uncaught.push(e.message));

// Reading a day of the month throws while the tab's storage says so.
await ctx.addInitScript(() => {
  const real = Date.prototype.getDate;
  Date.prototype.getDate = function getDate() {
    if (sessionStorage.getItem("vintage-break") === "1") throw new Error("broken on purpose");
    return real.call(this);
  };
});
const breakDates = (on) =>
  page.evaluate((v) => (v ? sessionStorage.setItem("vintage-break", "1") : sessionStorage.removeItem("vintage-break")), on);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const wait = (ms) => page.waitForTimeout(ms);
const text = async () => (await page.textContent("body")) ?? "";
const seen = (l) => l.locator("visible=true");
const byText = (t) => seen(page.getByText(t, { exact: true }));
const fields = () => seen(page.locator("input:not([type=checkbox]), textarea"));
const shot = (n) => (out ? page.screenshot({ path: `${out}/${n}.png` }) : Promise.resolve());
const go = async (path, ms = 2400) => {
  await page.goto(B + path, { waitUntil: "networkidle" });
  await wait(ms);
};

// A member, signed in.
await go("/", 1600);
await byText("Sign in").first().click();
await wait(1800);
await fields().nth(0).fill("elena@vintage.club");
await fields().nth(1).fill("vintage-demo");
await byText("Sign in").last().click();
await wait(3000);
check("Signed in to the feed", /elena\.marchetti|tomas\.lindqvist/.test(await text()));

// 1. A screen of its own breaks: only that screen, under its own header.
await breakDates(true);
await go("/memories", 2600);
let body = await text();
check("A broken screen shows the recover page, not a blank one", /This page didn’t open/.test(body), body.slice(0, 120));
check("…in our words, not the runtime's", !/broken on purpose|TypeError|undefined/.test(body));
check("…under its own header", /On this day/.test(body));
check("…and the app does not fall over", uncaught.length === 0, uncaught.join(" | "));
await shot("recover-01-screen");
await breakDates(false);
await byText("Try again").first().click();
await wait(2200);
body = await text();
check(
  "Try again brings the screen back",
  // The day's heading, which is what broke: "NOVEMBER 5, 2026".
  !/This page didn’t open/.test(body) && /[A-Z]+ \d{1,2}, (19|20)\d\d/.test(body),
  body.replace(/\s+/g, " ").slice(0, 160),
);

// 2. Home breaks: only Home, above the tab bar, with the tabs' header still up.
await breakDates(true);
await go("/", 3000);
body = await text();
check("A broken Home tab shows its own recover page", /This page didn’t open/.test(body), body.replace(/\s+/g, " ").slice(0, 160));
check("…not the whole app's", !/Something went wrong/.test(body));
check("…with the tabs still there to leave by", (await page.locator('[role="tab"]').count()) >= 5);
check("…and nothing escaped to the window", uncaught.length === 0, uncaught.join(" | "));
await shot("recover-02-home");
await breakDates(false);
await byText("Try again").first().click();
await wait(2600);
body = await text();
check("Try again brings the feed back", /elena\.marchetti|tomas\.lindqvist/.test(body) && !/This page didn’t open/.test(body), body.replace(/\s+/g, " ").slice(0, 160));

// 3. A photograph's page, opened straight from a link, breaks: only that page. Being the
// first in its stack, its header has no back button, so the way back is on the page.
await breakDates(true);
await go("/post/demo-post-01", 2600);
body = await text();
check("A broken photograph's page shows its own recover page", /This page didn’t open/.test(body) && !/Something went wrong/.test(body), body.replace(/\s+/g, " ").slice(0, 160));
check("…with the way back on the page", (await byText("Go back").count()) === 1);
check("…and says nothing of the runtime", !/broken on purpose|TypeError|undefined/.test(body));
await shot("recover-03-post");
await breakDates(false);
await byText("Try again").first().click();
await wait(2200);
body = await text();
check("Try again brings the photograph back", /The 19 tram/.test(body) && !/This page didn’t open/.test(body), body.replace(/\s+/g, " ").slice(0, 160));
await breakDates(true);
await go("/post/demo-post-01", 2600);
await breakDates(false);
await byText("Go back").first().click();
await wait(2600);
body = await text();
check(
  "Go back, with nothing before it, goes Home",
  /elena\.marchetti|tomas\.lindqvist/.test(body) && !/This page didn’t open/.test(body) && (await page.locator('[role="tab"]').count()) >= 5,
  body.replace(/\s+/g, " ").slice(0, 160),
);

// 4. Something with no screen boundary of its own breaks: the whole app's page.
// "Add to an era" is a sheet drawn without a boundary of its own.
await breakDates(true);
await go("/era-move?postId=demo-post-01", 3000);
body = await text();
check("The app's own recover page stands in for the whole app", /Something went wrong/.test(body) && /VINTAGE/.test(body), body.slice(0, 120));
check("…and says nothing of the runtime", !/broken on purpose|TypeError|undefined/.test(body));
check("…and nothing escaped to the window", uncaught.length === 0, uncaught.join(" | "));
await shot("recover-04-app");
await breakDates(false);
await byText("Try again").first().click();
await wait(3200);
body = await text();
check("Try again opens the app afresh, on the feed", /elena\.marchetti|tomas\.lindqvist/.test(body) && !/Something went wrong/.test(body));
await shot("recover-05-back");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
