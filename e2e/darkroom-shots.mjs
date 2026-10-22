// Screenshots of the Darkroom in the demo web build, at iPhone size.
// node e2e/darkroom-shots.mjs <outDir>   (serve dist/ on :8090 first)
import { chromium } from "playwright";
const out = process.argv[2] ?? ".";
const B = "http://127.0.0.1:8090";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_|Failed to load resource|no supported source/.test(m.text())) errors.push("console: " + m.text()); });
page.on("dialog", (d) => { console.log("dialog:", d.message().slice(0, 120)); d.accept(); });
const wait = (ms) => page.waitForTimeout(ms);
const seen = (l) => l.locator("visible=true");
const byText = (t) => seen(page.getByText(t, { exact: true }));
const shot = async (n) => { await page.screenshot({ path: `${out}/${n}.png` }); console.log("shot", n); };

await page.goto(B + "/", { waitUntil: "networkidle" });
await wait(1500);
await byText("Sign in").first().click();
await wait(1500);
const f = seen(page.locator("input"));
await f.nth(0).fill("elena@vintage.club");
await f.nth(1).fill("vintage-demo");
await byText("Sign in").last().click();
await wait(3000);
const steps = (process.argv[3] ?? "entry,room,years,year,ontheday,aside,develop").split(",");
const swipe = async () => {
  const box = { x: 393 / 2, y: 852 / 2 };
  await page.mouse.move(box.x + 120, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x - 160, box.y, { steps: 8 });
  await page.mouse.up();
  await wait(900);
};
for (const step of steps) {
  if (step === "entry") {
    await page.goto(B + "/create", { waitUntil: "networkidle" });
    await wait(2200);
    await shot("01-entry");
  } else if (step === "room") {
    await page.goto(B + "/darkroom", { waitUntil: "networkidle" });
    await wait(3500);
    await shot("02-room");
  } else if (step === "years") {
    await byText("By year").first().click();
    await wait(1500);
    await shot("03-years");
  } else if (step === "year") {
    const rows = seen(page.locator('[role="button"][aria-label*="photographs"]'));
    const n = await rows.count();
    if (n > 2) await rows.nth(2).click(); else if (n) await rows.first().click();
    await wait(2500);
    await shot("04-year");
  } else if (step === "ontheday") {
    await byText("On this day").first().click();
    await wait(2500);
    await shot("05-on-this-day");
  } else if (step === "aside") {
    await byText("Set aside").first().click();
    await wait(800);
    await shot("06a-set-aside-toggled");
    const bench = seen(page.getByText(/^Set aside · \d+$/));
    if (await bench.count()) { await bench.first().click(); await wait(2000); }
    await shot("06-set-aside");
  } else if (step === "develop") {
    await page.goto(B + "/darkroom?mode=surprise", { waitUntil: "networkidle" });
    await wait(3000);
    await byText("Develop").first().click();
    await wait(3500);
    await shot("07-editor");
  } else if (step === "swipe") {
    await swipe();
    await shot("08-swiped");
  }
}
console.log("errors:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
