// The Darkroom, walked through the real interface in the demo web build:
// the door on the Post tab → the first-visit page → On this day → a page
// turn → set aside → Contents and its years → a year's months → a year
// chapter → Surprise me → the Set aside chapter → the end of On this day
// → DEVELOP into the editor, and back to the same print.
//
//   npm run build:web && npm run test:darkroom      (SHOT_DIR=… to keep screenshots)
//
// The browser build reads a small bundled demo library (src/darkroom/
// demoSource.ts): six of its photographs fall on today's date in earlier
// years, so On this day always opens, and always ends after six. Demo
// state lives in the page, so after signing in everything is reached by
// tapping, never by loading a URL.
//
// The browser has no momentum scrolling to wait for, so a page turn here
// scrolls the pager by one page width, as a swipe that lands would; the
// room reads the page it settled on from the scroll position.
import { chromium } from "playwright";

const out = process.env.SHOT_DIR ?? null;
const B = "http://127.0.0.1:8090";
const W = 393;
const H = 852;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: out ? 3 : 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_|Failed to load resource|no supported source/.test(m.text())) errors.push("console: " + m.text());
});
// showAlert falls back to window.confirm on web; the room raises none, but sign-in might.
page.on("dialog", (d) => d.accept());

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const wait = (ms) => page.waitForTimeout(ms);
const seen = (l) => l.locator("visible=true");
const byText = (t) => seen(page.getByText(t, { exact: true }));
const byId = (id) => seen(page.locator(`[data-testid="${id}"]`));
let shots = 0;
const shot = async (name) => {
  shots += 1;
  if (out) await page.screenshot({ path: `${out}/darkroom-${String(shots).padStart(2, "0")}-${name}.png` });
};
const text = async () => ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
/** Waits for a test id to be on screen; false rather than throwing when it never is. */
const appears = async (id, timeout = 8000) =>
  page
    .locator(`[data-testid="${id}"]`)
    .locator("visible=true")
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
/** The date on the print in front of the member. */
const dateLabel = async () => ((await byId("darkroom-caption-date").first().textContent().catch(() => "")) ?? "").trim();
const chapterHead = async () => ((await byId("darkroom-chapter").first().textContent().catch(() => "")) ?? "").trim();
/** Turn `n` pages (negative: back), as a swipe that lands on the next page would. */
const turn = async (n = 1) => {
  await page.evaluate((pages) => {
    const lists = [...document.querySelectorAll('[data-testid="darkroom-pager"]')].filter((e) => e.offsetParent !== null);
    const list = lists[lists.length - 1];
    if (list) list.scrollBy({ left: list.clientWidth * pages, behavior: "instant" });
  }, n);
  await wait(900);
};
/**
 * On to the end of the chapter, the page after the last print — a page at a
 * time, as a member swipes. (One long jump lands among the list's unrendered
 * spacer, which has no snap points in the browser, and snaps back.)
 */
const endInFront = () =>
  page.evaluate((width) => {
    const end = document.querySelector('[data-testid="darkroom-end"]');
    if (!end) return false;
    const r = end.getBoundingClientRect();
    return r.width > 0 && Math.abs(r.left) < width / 2;
  }, W);
const toEnd = async (limit = 60) => {
  for (let i = 0; i < limit; i++) {
    if (await endInFront()) return true;
    await turn(1);
  }
  return endInFront();
};
const openContents = async () => {
  await byId("darkroom-contents").first().click();
  return appears("darkroom-contents-sheet", 5000);
};

// --- signed in as a demo member ---------------------------------------------------
await page.goto(B + "/", { waitUntil: "networkidle" });
await wait(1500);
await byText("Sign in").first().click();
await wait(1500);
const f = seen(page.locator("input"));
await f.nth(0).fill("elena@vintage.club");
await f.nth(1).fill("vintage-demo");
await byText("Sign in").last().click();
await wait(3000);

// --- the door on the Post tab -----------------------------------------------------
await page.goto(B + "/create", { waitUntil: "networkidle" });
await wait(2200);
const post = await text();
check(
  "The Post tab offers the Memory Room",
  /The Memory Room/.test(post) && /Rediscover something worth sharing\.|You left off in /.test(post),
);
check("The ordinary picker is still one tap away", /From your library/.test(post) && /Choose a photograph/.test(post));
await shot("entry");

// --- the first visit ----------------------------------------------------------------
// The bar's name is its words (and the arrow drawn after them).
const door = seen(page.getByRole("button", { name: /^Enter the Memory Room/i })).first();
check("The Memory Room has its own bar on the Post tab", (await door.count()) > 0);
if (await door.count()) await door.click();
else await page.goto(B + "/darkroom", { waitUntil: "networkidle" });
const firstVisit = await appears("darkroom-page-firstVisit");
check("First visit opens on the first-visit page", firstVisit && /One photograph at a time\./.test(await text()));
const words = await seen(page.locator('[data-testid^="darkroom-word-"]')).allTextContents();
check("The first-visit page has exactly one word", words.length === 1 && /^Enter$/i.test(words[0]?.trim() ?? ""), words.join(" · "));
check("It promises nothing leaves the phone", /Nothing leaves it unless you post it\./.test(await text()));
await shot("first-visit");

// --- entering: On this day -----------------------------------------------------------
await byId("darkroom-word-enter").first().click();
const opened = await appears("darkroom-caption-date", 10000);
await wait(900);
const firstDate = await dateLabel();
check("Entering opens On this day, on today’s date", opened && /on this day/i.test(await chapterHead()) && /years ago today/.test(await text()), firstDate);
check("DEVELOP is the page’s one ruled word", (await byId("darkroom-develop").count()) > 0);
await shot("discovery");

// --- a page turn -----------------------------------------------------------------------
await turn(1);
const secondDate = await dateLabel();
check("A page turn moves to the next year’s photograph", secondDate !== "" && secondDate !== firstDate, `${firstDate} → ${secondDate}`);
await shot("on-this-day");

// --- set aside ----------------------------------------------------------------------------
// Set aside, the word turns from faint to the room's cream ink, beside its gold dot.
const asideInk = () =>
  page.evaluate(() => {
    const word = [...document.querySelectorAll('[data-testid="darkroom-caption-word"]')].find((e) => e.offsetParent !== null);
    const letters = word ? [...word.querySelectorAll("div")].find((d) => /set aside/i.test(d.textContent ?? "")) : null;
    return letters ? getComputedStyle(letters).color : "";
  });
const before = await asideInk();
await byId("darkroom-caption-word").first().click();
await wait(600);
const after = await asideInk();
check("SET ASIDE marks the print", before !== after && /246, 236, 223/.test(after), `${before} → ${after}`);

// --- Contents, and the years ------------------------------------------------------------------
check("CONTENTS opens the sheet", await openContents());
await wait(1500);
const sheet = await text();
check("Contents lists the three ways in", /On this day/.test(sheet) && /Surprise me/.test(sheet) && /Set aside/.test(sheet));
const yearLines = seen(page.locator('[data-testid^="darkroom-contents-1"], [data-testid^="darkroom-contents-2"]'));
const yearCount = await yearLines.count();
const yearTitles = (await yearLines.allTextContents()).map((t) => t.match(/\d{4}/)?.[0]).filter(Boolean).map(Number);
check(
  "Contents lists the years, oldest first",
  yearCount >= 3 && yearTitles.every((y, i) => i === 0 || y > yearTitles[i - 1]),
  yearTitles.join(", "),
);
check("Contents says everything is read on the phone", /Everything here is read on this iPhone\. Nothing is sent\./.test(sheet));
await shot("contents");

// --- a year, and its months -------------------------------------------------------------------
const chosenYear = yearTitles[Math.min(2, yearTitles.length - 1)];
await yearLines.nth(Math.min(2, yearCount - 1)).click();
await wait(2600);
check("A year opens as a chapter", (await chapterHead()) === String(chosenYear), await chapterHead());
const yearLine = ((await byId("darkroom-caption-line").first().textContent().catch(() => "")) ?? "").trim();
check("The year’s caption gives the weekday", /^A (Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day\b/.test(yearLine), yearLine || (await text()).slice(0, 300));

await openContents();
await wait(1400);
const months = seen(page.locator('[data-testid^="darkroom-month-"]'));
check("The open year shows its twelve months", (await months.count()) === 12);
await shot("months");
const filled = seen(page.locator('[data-testid^="darkroom-month-"]:not([aria-disabled="true"])'));
const filledCount = await filled.count();
check("Months with photographs can be chosen; empty ones cannot", filledCount > 0 && filledCount < 12, `${filledCount} of 12`);
await filled.nth(filledCount - 1).click();
await wait(2600);
check("A month opens the year from that month", (await chapterHead()) === String(chosenYear) && (await dateLabel()) !== "");
await shot("year");

// --- Surprise me -----------------------------------------------------------------------------------
await openContents();
await wait(900);
await byId("darkroom-contents-surprise-me").first().click();
await wait(2800);
const surprise = await text();
check("Surprise me deals an older photograph", /surprise me/i.test(await chapterHead()) && /(years ago|Last year)/.test(surprise));
await shot("surprise");

// --- Set aside ---------------------------------------------------------------------------------------
await openContents();
await wait(900);
await byId("darkroom-contents-set-aside").first().click();
await wait(2200);
const shelfWord = ((await byId("darkroom-caption-word").first().textContent().catch(() => "")) ?? "").trim();
check("The shelf opens as its own chapter, with PUT BACK", /set aside/i.test(await chapterHead()) && /put back/i.test(shelfWord), shelfWord);
await shot("set-aside");

// --- the end of On this day ---------------------------------------------------------------------------
await openContents();
await wait(900);
await byId("darkroom-contents-on-this-day").first().click();
await wait(2200);
check("On this day comes back to the print it was left on", (await dateLabel()) === secondDate, await dateLabel());
const ended = await toEnd();
check("On this day ends on its end page", ended && /That is everything from this (day|week|time of year)/.test(await text()));
check("The end page hands on to another way in", /Surprise me/i.test(await text()) && /Choose a year/i.test(await text()));
await shot("end");

// --- DEVELOP into the editor, and back --------------------------------------------------------------------
await turn(-1);
const developed = await dateLabel();
await byId("darkroom-develop").first().click();
await wait(4500);
const editor = await text();
check("DEVELOP opens the existing editor", /Share to VINTAGE/.test(editor) && /Film|FILM/.test(editor));
check("The editor knows when the shutter fired", /Read from the file/.test(editor));
await shot("editor");
await page.goBack();
await wait(2200);
check("Back from the editor, the room is as it was", (await dateLabel()) === developed && (await byId("darkroom-develop").count()) > 0, developed);

console.log("\nJS errors:", errors.length ? errors.slice(0, 10) : "none");
check("No page errors", errors.length === 0);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log("FAILED: " + failed.map((r) => r.name).join(" | "));
await browser.close();
process.exit(failed.length ? 1 : 0);
