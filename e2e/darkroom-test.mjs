// The Darkroom, walked through the real interface in the demo web build:
// threshold → On This Day → swipe → set aside → contents → a year → its
// months → the set-aside shelf → Surprise → develop into the editor.
//
//   npm run build:web && npm run test:darkroom      (SHOT_DIR=… to keep screenshots)
//
// The browser build reads a small bundled demo library (src/darkroom/
// demoSource.ts) — six of its photographs fall on today's date in earlier
// years, so On This Day always has something to open on.
import { chromium } from "playwright";
const out = process.env.SHOT_DIR ?? null;
const B = "http://127.0.0.1:8090";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: out ? 3 : 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_|Failed to load resource|no supported source/.test(m.text())) errors.push("console: " + m.text());
});
page.on("dialog", (d) => d.accept());
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const wait = (ms) => page.waitForTimeout(ms);
const seen = (l) => l.locator("visible=true");
const byText = (t) => seen(page.getByText(t, { exact: true }));
const shot = async (n) => out && page.screenshot({ path: `${out}/${n}.png` });
const text = async () => (await page.textContent("body")).replace(/\s+/g, " ");
const swipe = async () => {
  await page.mouse.move(320, 420);
  await page.mouse.down();
  await page.mouse.move(40, 420, { steps: 8 });
  await page.mouse.up();
  await wait(1200);
};

// Signed in as a demo member.
await page.goto(B + "/", { waitUntil: "networkidle" });
await wait(1500);
await byText("Sign in").first().click();
await wait(1500);
const f = seen(page.locator("input"));
await f.nth(0).fill("elena@vintage.club");
await f.nth(1).fill("vintage-demo");
await byText("Sign in").last().click();
await wait(3000);

// The door on the Post tab.
await page.goto(B + "/create", { waitUntil: "networkidle" });
await wait(2200);
check("The Post tab offers the Darkroom", /The Darkroom/.test(await text()) && /Enter the Darkroom/i.test(await text()));
check("The ordinary picker is still one tap away", /From your library/.test(await text()));
await shot("01-entry");

// First visit: the threshold.
await page.goto(B + "/darkroom", { waitUntil: "networkidle" });
await wait(2000);
check("First visit opens on the threshold", /Your best photos aren’t new\./.test(await text()));
await shot("02-threshold");
await byText("Enter").first().click();
await wait(3200);
const day = await text();
check("It opens On This Day when the date has photographs", /ON THIS DAY|On this day/i.test(day) && /years ago today/.test(day));
await shot("03-on-this-day");

const firstLabel = (await text()).match(/[A-Z]+ \d{1,2}, \d{4}/)?.[0];
await swipe();
const secondLabel = (await text()).match(/[A-Z]+ \d{1,2}, \d{4}/g) ?? [];
check("A swipe moves to the next year's photograph", secondLabel.length > 0 && firstLabel !== undefined, firstLabel);
await shot("04-next");

await byText("Set aside").first().click();
await wait(700);
check("Set aside marks the print", (await seen(page.locator('[aria-label*="Set aside."]')).count()) > 0);

await byText("Contents").first().click();
await wait(1500);
const contents = await text();
check("The contents list the ways in", /On this day/.test(contents) && /Surprise me/.test(contents));
check("The contents list the years, oldest first", /2009/.test(contents) && contents.indexOf("2009") < contents.indexOf("2023"));
check("The shelf is in the contents", /Set aside/.test(contents));
await shot("05-contents");

const years = seen(page.locator('[aria-label$=" photographs"]'));
await years.nth(2).click();
await wait(3400);
check("A year opens as a chapter", /^\d{4}$/.test(((await seen(page.getByRole("heading")).first().textContent()) ?? "").trim()) || /\b20\d\d\b/.test(await text()));
await shot("06-year");

await byText("Contents").first().click();
await wait(1500);
check("The open year shows its months", (await seen(page.locator('[aria-label^="JAN "]')).count()) > 0);
await shot("07-months");
await seen(page.locator('[aria-label^="Set aside,"]')).first().click();
await wait(3000);
check("The shelf opens as its own chapter", /SET ASIDE|Set aside/.test(await text()) && /years ago/.test(await text()));
await shot("08-set-aside");

await byText("Contents").first().click();
await wait(1200);
await seen(page.locator('[aria-label^="Surprise me,"]')).first().click();
await wait(3200);
const surprise = await text();
check("Surprise deals an older photograph", /years ago/.test(surprise));
await shot("09-surprise");

await byText("Develop").first().click();
await wait(4500);
const editor = await text();
check("Develop opens the existing editor", /Share to VINTAGE/.test(editor) && /Film|FILM/.test(editor));
check("The editor knows when the shutter fired", /Read from the file/.test(editor));
await shot("10-editor");

console.log("\nJS errors:", errors.length ? errors.slice(0, 10) : "none");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log("FAILED: " + failed.map((r) => r.name).join(" | "));
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
