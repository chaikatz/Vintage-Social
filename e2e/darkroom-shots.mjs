// Screenshots of the Darkroom in the demo web build, at iPhone size.
//   node e2e/serve.mjs &   then   node e2e/darkroom-shots.mjs <outDir>
import { chromium } from "playwright";
const out = process.argv[2] ?? ".";
const B = "http://127.0.0.1:8090";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_|Failed to load resource|no supported source/.test(m.text())) errors.push("console: " + m.text()); });
page.on("dialog", (d) => { console.log("dialog:", d.message().slice(0, 140)); d.accept(); });
const wait = (ms) => page.waitForTimeout(ms);
const seen = (l) => l.locator("visible=true");
const byText = (t) => seen(page.getByText(t, { exact: true }));
const byLabel = (t) => seen(page.getByLabel(t, { exact: true }));
const shot = async (n) => { await page.screenshot({ path: `${out}/${n}.png` }); console.log("shot", n); };
const text = async () => (await page.textContent("body")).replace(/\s+/g, " ");

await page.goto(B + "/", { waitUntil: "networkidle" });
await wait(1500);
await byText("Sign in").first().click();
await wait(1500);
const f = seen(page.locator("input"));
await f.nth(0).fill("elena@vintage.club");
await f.nth(1).fill("vintage-demo");
await byText("Sign in").last().click();
await wait(3000);

await page.goto(B + "/create", { waitUntil: "networkidle" });
await wait(2200);
await shot("01-entry");

await page.goto(B + "/darkroom", { waitUntil: "networkidle" });
await wait(2000);
await shot("02-threshold");
await byText("Enter").first().click();
await wait(400);
await shot("03-title-card");
await wait(2500);
await shot("04-on-this-day");

// swipe to the next print
await page.mouse.move(320, 420); await page.mouse.down(); await page.mouse.move(40, 420, { steps: 8 }); await page.mouse.up();
await wait(1200);
await shot("05-on-this-day-next");

await byText("Set aside").first().click();
await wait(700);
await shot("06-set-aside-on");

await byText("Contents").first().click();
await wait(1500);
await shot("07-contents");

const years = seen(page.locator('[aria-label$="photographs"]'));
const n = await years.count();
console.log("year lines:", n);
await years.nth(Math.min(2, n - 1)).click();
await wait(400);
await shot("08-year-title");
await wait(2600);
await shot("09-year");

await byText("Contents").first().click();
await wait(1500);
await shot("10-contents-months");
const months = seen(page.locator('[aria-label^="JUN "], [aria-label^="MAR "], [aria-label^="SEP "]'));
console.log("months visible:", await months.count());
await byLabel("Done").first().click().catch(async () => byText("Done").first().click());
await wait(1000);

await byText("Contents").first().click();
await wait(1200);
await seen(page.locator('[aria-label^="Set aside,"]')).first().click();
await wait(2600);
await shot("11-set-aside");

await byText("Contents").first().click();
await wait(1200);
await seen(page.locator('[aria-label^="Surprise me,"]')).first().click();
await wait(3000);
await shot("12-surprise");

await byText("Develop").first().click();
await wait(4000);
await shot("13-editor");
console.log("editor has date stamp:", /DATE STAMP|Date stamp/i.test(await text()));

console.log("errors:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
