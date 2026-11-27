// The Darkroom, walked through the real interface in the demo web build:
// MEMORY ROOM on the Post tab → the first-visit page → On this day, on the
// app's own page, each plate with its signature line, CONTENTS a tab with
// a line under it on a first visit, POST under the caption and the glide
// strip under POST, with nothing pressed → a page turn, and the strip
// following it → taps on the photograph, either half → a frame tapped →
// a glide across the strip, the page following it and landing where it
// comes to rest, the photograph and its caption just where the preview
// stood them → a scrub paused on a frame, drawn sharp → set aside →
// Contents, read as an index, and its years → a year's months → a year
// chapter, its months along the strip → Surprise me, dealt on as the strip
// nears its end → the Set aside chapter → the end of On this day, its
// blank frame under the box → POST back on the photograph every way there
// is of coming back from the end page (a frame, a swipe, a glide), which is
// where build 58 lost it on the phone → POST into the editor, and back to
// the same print → the room on a 320-point phone, and a glide landing
// there just where its preview stood, its caption's word on a line of its
// own. POST is checked on every photograph's page the walk comes to: a
// chapter changed, a roll dealt on, the shelf.
//
//   npm run build:web && npm run test:darkroom      (SHOT_DIR=… to keep screenshots)
//
// E2E_BASE points it at a build served elsewhere (the default is e2e/serve.mjs's);
// E2E_W and E2E_H set the phone (393 × 852 by default).
//
// The browser build reads a small bundled demo library (src/darkroom/
// demoSource.ts): six of its photographs fall on today's date in earlier
// years, so On this day always opens, and always ends after six. Demo
// state lives in the page, so after signing in everything is reached by
// tapping, never by loading a URL.
//
// The browser has no momentum scrolling to wait for, so a page turn here
// scrolls the pager by one page width, as a swipe that lands would; the
// room reads the page it settled on from the scroll position. A glide sets
// the strip's scroll the same way: the strip takes any offset it did not
// ask for as a finger's, and one left still for a moment as let go.
import { chromium } from "playwright";

const out = process.env.SHOT_DIR ?? null;
const B = process.env.E2E_BASE ?? "http://127.0.0.1:8090";
const W = Number(process.env.E2E_W ?? 393);
const H = Number(process.env.E2E_H ?? 852);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
/** A phone of this size, as the browser draws it. */
const phone = async (width, height) => {
  // The browser asks for its dark scheme: the app, and so the room, still show the light print there.
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: out ? 2 : 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/ERR_|Failed to load resource|no supported source/.test(m.text())) errors.push("console: " + m.text());
  });
  // showAlert falls back to window.confirm on web; the room raises none, but sign-in might.
  p.on("dialog", (d) => d.accept());
  return p;
};
const page = await phone(W, H);

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

// The glide strip: the browser's scroll of its list is the finger.
/** Where the strip has been scrolled to, in points; a frame is 36. */
const stripLeft = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="darkroom-glide-strip"]')].find((e) => e.offsetParent !== null);
    return el ? Math.round(el.scrollLeft * 10) / 10 : -1;
  });
/** A finger's glide, as the browser has it: the strip scrolled to `x`. */
const glideOn = (p, x) =>
  p.evaluate((left) => {
    const el = [...document.querySelectorAll('[data-testid="darkroom-glide-strip"]')].find((e) => e.offsetParent !== null);
    if (el) el.scrollLeft = left;
  }, x);
const glideTo = (x) => glideOn(page, x);
/** How many frames the strip holds, the blank one included, read from its length rather than the frames drawn. */
const stripFrames = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="darkroom-glide-strip"]')].find((e) => e.offsetParent !== null);
    return el ? Math.round((el.scrollWidth - (el.clientWidth - 36)) / 36) : -1;
  });
/** Waits until `fn` says so, up to `ms`; whether it did. */
const until = async (fn, ms, step = 25) => {
  for (let t = 0; t <= ms; t += step) {
    if (await fn()) return true;
    await wait(step);
  }
  return false;
};
/** A view's opacity as the eye sees it: its own and every one around it. */
const seenOpacityOn = (p, id) =>
  p.evaluate((testId) => {
    const el = [...document.querySelectorAll(`[data-testid="${testId}"]`)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return -1;
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity || 1);
    return Math.round(o * 100) / 100;
  }, id);
const seenOpacity = (id) => seenOpacityOn(page, id);
/** What POST says: the word under the photograph (its test id is still the code's, develop). */
const postSays = async () => ((await byId("darkroom-develop").first().textContent().catch(() => "")) ?? "").trim();
/** POST is under the photograph in front, whole and saying POST; it comes in over 160 ms as a page settles. */
const postShown = () => until(async () => /^Post$/i.test(await postSays()) && (await seenOpacity("darkroom-develop")) > 0.99, 1500);
/** Where a view stands on the phone: the one on screen, left to right. */
const boxOn = (p, id) =>
  p.evaluate((testId) => {
    const el = [...document.querySelectorAll(`[data-testid="${testId}"]`)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.left >= -1 && r.left < window.innerWidth;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
  }, id);
/** The preview's plate and date while gliding, and the page's own once landed. */
const previewOn = async (p) => ({ plate: await boxOn(p, "darkroom-glide-plate"), date: await boxOn(p, "darkroom-glide-caption-date") });
const pageOn = async (p) => ({ plate: await boxOn(p, "darkroom-plate"), date: await boxOn(p, "darkroom-caption-date") });
/** Within a point of each other: the plate's every edge, and where the date stands. */
const standsAlike = (a, b) =>
  a.plate != null &&
  b.plate != null &&
  a.date != null &&
  b.date != null &&
  ["x", "y", "width", "height"].every((k) => Math.abs(a.plate[k] - b.plate[k]) <= 1) &&
  Math.abs(a.date.x - b.date.x) <= 1 &&
  Math.abs(a.date.y - b.date.y) <= 1;
/** The date in the preview over the page while gliding. */
const sheetDate = async () => ((await byId("darkroom-glide-caption-date").first().textContent().catch(() => "")) ?? "").trim();
const marksShown = () => seen(page.locator('[data-testid^="darkroom-glide-mark-"]')).count();

/** Signed in as a demo member. */
const signIn = async (p) => {
  await p.goto(B + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await seen(p.getByText("Sign in", { exact: true })).first().click();
  await p.waitForTimeout(1500);
  const f = seen(p.locator("input"));
  await f.nth(0).fill("elena@vintage.club");
  await f.nth(1).fill("vintage-demo");
  await seen(p.getByText("Sign in", { exact: true })).last().click();
  await p.waitForTimeout(3000);
};
/** Through the Post tab's header, MEMORY ROOM, and the first-visit page, into On this day. */
const enterRoom = async (p) => {
  await p.goto(B + "/create", { waitUntil: "networkidle" });
  await p.waitForTimeout(2200);
  const bar = seen(p.locator('[data-testid="post-head-room"]')).first();
  if (await bar.count()) await bar.click();
  else await p.goto(B + "/darkroom", { waitUntil: "networkidle" });
  await seen(p.locator('[data-testid="darkroom-word-enter"]')).first().click({ timeout: 10000 });
  await seen(p.locator('[data-testid="darkroom-caption-date"]')).first().waitFor({ state: "visible", timeout: 10000 });
  await p.waitForTimeout(900);
};

// --- signed in as a demo member ---------------------------------------------------
await signIn(page);

// --- the way in on the Post tab ---------------------------------------------------
await page.goto(B + "/create", { waitUntil: "networkidle" });
await wait(2200);
const post = await text();
check(
  "The Post tab offers the Memory Room, beside Recent at its top",
  /Recent/.test(post) && /Memory Room/.test(post) && (await seen(page.getByRole("button", { name: /^Memory Room$/ })).count()) > 0,
);
check("The ordinary picker is still one tap away", (await seen(page.getByRole("button", { name: /^Library$/ })).count()) > 0);
await shot("entry");

// --- the first visit ----------------------------------------------------------------
// MEMORY ROOM in the Post tab's header, which slides to the room's door and opens the room.
const door = seen(page.getByRole("button", { name: /^Memory Room$/ })).first();
check("The Memory Room has its own way in on the Post tab", (await door.count()) > 0);
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
check("POST is the page’s one ruled word, and says POST", (await byId("darkroom-develop").count()) > 0 && (await postShown()), await postSays());
await shot("discovery");

// --- the room's page: the app's own, and the light print in the browser -----------------
// The light print's paper is #FAF6EF and its accent #A65B2A; the brown dark print's page was #2F221E.
const LIGHT_PAPER = "rgb(250, 246, 239)";
const LIGHT_ACCENT = "rgb(166, 91, 42)";
const style = (id, prop) =>
  page.evaluate(
    ([testId, p]) => {
      const el = [...document.querySelectorAll(`[data-testid="${testId}"]`)].find((e) => e.getBoundingClientRect().width > 0);
      return el ? getComputedStyle(el)[p] : "";
    },
    [id, prop],
  );
const box = (id) => boxOn(page, id);
const roomPage = await style("darkroom", "backgroundColor");
const dateInk = await page.evaluate(() => {
  const date = [...document.querySelectorAll('[data-testid="darkroom-caption-date"]')].find((e) => e.offsetParent !== null);
  const letters = date ? [...date.querySelectorAll("div")].find((d) => d.children.length === 0 && /\d{4}/.test(d.textContent ?? "")) : null;
  return letters ? getComputedStyle(letters).color : "";
});
check(
  "The room is printed on the app’s own page: the light print in the browser, even set dark",
  roomPage === LIGHT_PAPER && dateInk === LIGHT_ACCENT,
  `${roomPage} · date ${dateInk}`,
);

// --- the signature line ------------------------------------------------------------------
// The print's hairline rule under the photograph: the plate's width, a sixteenth of it below, the caption under it.
const plate0 = await box("darkroom-plate");
const rule0 = await box("darkroom-caption-signature");
const date0 = await box("darkroom-caption-date");
check(
  "The signature line hangs under the plate, its width, a sixteenth of it below",
  plate0 != null &&
    rule0 != null &&
    Math.abs(rule0.width - plate0.width) <= 1 &&
    Math.abs(rule0.x - plate0.x) <= 1 &&
    rule0.height >= 0.9 &&
    rule0.height <= 1.5 &&
    Math.abs(rule0.y - plate0.bottom - plate0.width / 16) <= 1,
  JSON.stringify({ plate: plate0, rule: rule0 }),
);
check(
  "…in the print’s strong line, with the caption hung beneath it",
  rule0 != null && date0 != null && date0.y + 10 >= rule0.bottom && (await style("darkroom-caption-signature", "backgroundColor")) === "rgb(213, 203, 184)",
  `${await style("darkroom-caption-signature", "backgroundColor")}`,
);
await shot("signature");

// --- CONTENTS: a tab, and on a first visit the line under it -------------------------------
const press = await box("darkroom-contents");
const tab = await box("darkroom-contents-tab");
const tabText = ((await byId("darkroom-contents-tab").first().textContent().catch(() => "")) ?? "").trim();
check(
  "CONTENTS is a tab with an open book, its press at least 44 × 44",
  press != null && press.height >= 44 && press.width >= 44 && tab != null && tab.height >= 30 && tab.width >= 96 && /Contents$/.test(tabText) && tabText.length > "Contents".length,
  JSON.stringify({ press, tab, tabText }),
);
check(
  "On a first visit the tab is ruled in the accent",
  (await style("darkroom-contents-tab", "borderTopColor")) === LIGHT_ACCENT && (await style("darkroom-contents-tab", "borderTopWidth")) === "1px",
  await style("darkroom-contents-tab", "borderTopColor"),
);
const invite = await box("darkroom-contents-invite");
const inviteText = ((await byId("darkroom-contents-invite").first().textContent().catch(() => "")) ?? "").trim();
check(
  "…and a line under it says what is in Contents",
  invite != null && tab != null && invite.y >= tab.bottom - 2 && Math.abs(invite.right - (press?.right ?? 0)) <= 2 && inviteText === "Every way in is here: this day, a roll, any year.",
  `${inviteText} ${JSON.stringify(invite)}`,
);
const plateBelow = await box("darkroom-plate");
check("The line keeps off the photograph", invite != null && plateBelow != null && invite.bottom <= plateBelow.y, JSON.stringify(plateBelow));
await shot("contents-tab");

// --- the glide strip ---------------------------------------------------------------------
// Under POST on every page, at the page's foot, with nothing to press to reach it.
check("The glide strip comes onto the page by itself", await appears("darkroom-glide-strip-row", 3000));
await wait(400);
const stripRow = await box("darkroom-glide-strip-row");
const stripBox = await box("darkroom-glide-box");
const caption0 = await box("darkroom-caption");
const develop0 = await box("darkroom-develop");
check(
  "POST stands under the caption, and the strip under POST: the page's width less its gutters, 68 pt high, at the foot",
  stripRow != null &&
    caption0 != null &&
    develop0 != null &&
    caption0.bottom <= develop0.y &&
    Math.abs(develop0.height - 48) <= 1 &&
    Math.abs(develop0.x + develop0.width / 2 - W / 2) <= 1 &&
    Math.abs(stripRow.y - develop0.bottom - 12) <= 1 &&
    Math.abs(stripRow.x - 16) <= 1 &&
    Math.abs(stripRow.width - (W - 32)) <= 1 &&
    Math.abs(stripRow.height - 68) <= 1 &&
    // The browser has no safe area: the strip stands 4 above the 16 the page keeps at its foot.
    Math.abs(H - stripRow.bottom - 20) <= 1,
  JSON.stringify({ stripRow, caption0, develop0 }),
);
check(
  "…its grease-pencil box fixed over the middle",
  stripBox != null && Math.abs(stripBox.x + stripBox.width / 2 - W / 2) <= 1,
  JSON.stringify(stripBox),
);
const frameIds = ["darkroom-glide-cell-0", "darkroom-glide-cell-1", "darkroom-glide-cell-2", "darkroom-glide-cell-3", "darkroom-glide-cell-4", "darkroom-glide-cell-5", "darkroom-glide-tail"];
const framesThere = await page.evaluate((ids) => ids.every((id) => document.querySelector(`[data-testid="${id}"]`) != null), frameIds);
check("A frame for each of the day's six photographs, and a blank frame after them", framesThere && (await stripFrames()) === 7, String(await stripFrames()));
const playLeft = await page.evaluate(
  () => ["darkroom-play", "darkroom-play-tab", "darkroom-replay", "darkroom-word-play"].filter((id) => document.querySelector(`[data-testid="${id}"]`) != null),
);
check("There is no play button, and no replay", playLeft.length === 0, playLeft.join(" "));
check("The year is printed along the strip's edge", /^\d{4}$/.test(((await byId("darkroom-glide-mark-0").first().textContent().catch(() => "")) ?? "").trim()));
await shot("strip");

// --- a page turn -----------------------------------------------------------------------
await page.evaluate(() => {
  const lists = [...document.querySelectorAll('[data-testid="darkroom-pager"]')].filter((e) => e.offsetParent !== null);
  const list = lists[lists.length - 1];
  if (list) list.scrollBy({ left: list.clientWidth, behavior: "instant" });
});
const followed = await until(async () => Math.abs((await stripLeft()) - 36) <= 1, 600);
await wait(500);
const secondDate = await dateLabel();
check("A page turn moves to the next year’s photograph", secondDate !== "" && secondDate !== firstDate, `${firstDate} → ${secondDate}`);
check("…and the strip follows it, a frame on", followed, String(await stripLeft()));
await shot("on-this-day");

// --- a tap on the photograph ---------------------------------------------------------------
// The right half turns on and the left half back, by the pager's own
// scroll; quick taps turn one page; and the room's words stay on the
// page, since a tap no longer hides them. Left on the second print, as
// the turn above left it.
const plateBox = () =>
  page.evaluate(() => {
    const plates = [...document.querySelectorAll('[data-testid="darkroom-plate"]')].map((e) => e.getBoundingClientRect());
    const r = plates.find((b) => b.width > 0 && b.left >= 0 && b.left < window.innerWidth);
    return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
  });
/** Which page the pager has come to, counting the chapter's first as 0. */
const pagerPage = () =>
  page.evaluate(() => {
    const lists = [...document.querySelectorAll('[data-testid="darkroom-pager"]')].filter((e) => e.offsetParent !== null);
    const list = lists[lists.length - 1];
    return list ? Math.round((list.scrollLeft / list.clientWidth) * 100) / 100 : -1;
  });
/** A finger on the photograph in front, `at` across it: 0 its left edge, 1 its right. */
const tapPlate = async (at) => {
  const b = await plateBox();
  if (b) await page.touchscreen.tap(b.x + b.width * at, b.y + b.height / 2);
  await wait(900);
};
const wordsShowing = () =>
  page.evaluate(() =>
    ["darkroom-back", "darkroom-chapter", "darkroom-contents", "darkroom-caption-date", "darkroom-develop"].every((id) => {
      const el = [...document.querySelectorAll(`[data-testid="${id}"]`)].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.left >= 0 && r.left < window.innerWidth;
      });
      let opacity = 1;
      for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity || 1);
      return el != null && opacity > 0.99;
    }),
  );
await tapPlate(0.2);
check("A tap on the photograph’s left half turns back a page", (await dateLabel()) === firstDate, await dateLabel());
await tapPlate(0.2);
check("…and on the first print turns nothing", (await dateLabel()) === firstDate, await dateLabel());
await tapPlate(0.8);
check("A tap on its right half turns on a page", (await dateLabel()) === secondDate, await dateLabel());
check("The room’s words stay on the page after a tap", await wordsShowing());
await shot("tapped");
const spot = await plateBox();
for (let i = 0; i < 3; i++) {
  if (spot) await page.touchscreen.tap(spot.x + spot.width * 0.85, spot.y + spot.height / 2);
  await wait(40);
}
await wait(900);
const thirdDate = await dateLabel();
check("Quick taps turn one page at a time", thirdDate !== secondDate && thirdDate !== "" && (await pagerPage()) === 2, thirdDate);
await tapPlate(0.15);
check("…and the left half brings it back", (await dateLabel()) === secondDate, await dateLabel());
check("The strip follows the taps too", Math.abs((await stripLeft()) - (await pagerPage()) * 36) <= 1, `${await stripLeft()} · page ${await pagerPage()}`);

// --- a frame tapped --------------------------------------------------------------------------
await byId("darkroom-glide-cell-2").first().click();
await wait(700);
check(
  "A frame tapped goes straight to its photograph, and the strip with it",
  (await dateLabel()) === thirdDate && (await pagerPage()) === 2 && Math.abs((await stripLeft()) - 72) <= 1,
  `${await dateLabel()} · page ${await pagerPage()} · strip ${await stripLeft()}`,
);
await byId("darkroom-glide-cell-1").first().click();
await wait(700);
check("…and back", (await dateLabel()) === secondDate && (await pagerPage()) === 1, await dateLabel());

// --- a glide --------------------------------------------------------------------------------
// Slid a frame on: the page follows the frame under the box at once, as a preview over the photograph, while
// the pager itself waits. Let go, the room lands there as a page turn would.
await glideTo(72);
const previewing = await until(async () => (await seenOpacity("darkroom-glide-sheet")) > 0.99 && (await sheetDate()) === thirdDate, 100, 10);
// Read before the strip has been still long enough to count as let go.
const underPreview = { date: await dateLabel(), page: await pagerPage() };
const previewStood = await previewOn(page);
await shot("gliding");
check("Gliding a frame on, the page follows it at once", previewing, `${previewing} ${await sheetDate()}`);
check("…while the pager itself has not moved", underPreview.date === secondDate && underPreview.page === 1, JSON.stringify(underPreview));
await wait(1500);
const developDisabled = async () => (await byId("darkroom-develop").first().getAttribute("aria-disabled").catch(() => null)) === "true";
check(
  "Let go, the room lands on that photograph, as a page turn would",
  (await byId("darkroom-glide-sheet").count()) === 0 && (await dateLabel()) === thirdDate && (await pagerPage()) === 2 && !(await developDisabled()),
  `${await dateLabel()} · page ${await pagerPage()} · sheet ${await byId("darkroom-glide-sheet").count()}`,
);
const landedStood = await pageOn(page);
check("…its photograph and caption just where the preview stood them", standsAlike(previewStood, landedStood), JSON.stringify({ previewStood, landedStood }));

// --- a scrub, paused on a frame ----------------------------------------------------------------
// Slid on two frames and held there, the finger still on the strip: the photograph comes sharp.
await glideTo(108);
await wait(50);
await glideTo(144);
for (let t = 0; t < 8; t++) {
  await wait(50);
  await glideTo(t % 2 === 0 ? 143 : 144);
}
const pausedOn = await sheetDate();
const sharp = (await page.locator('[data-testid="darkroom-glide-sharp"]').count()) > 0;
// Read before the screenshot: with SHOT_DIR set, the shot takes long enough that the strip has been
// still long enough to count as let go, and the room has landed by the time it returns.
const pausedPage = await pagerPage();
await shot("glide-paused");
check(
  "Paused on a frame mid-glide, its photograph is drawn sharp, and the pager still waits",
  pausedOn !== "" && ![firstDate, secondDate, thirdDate].includes(pausedOn) && sharp && pausedPage === 2,
  `${pausedOn} sharp=${sharp} page ${pausedPage}`,
);
await wait(1500);
check(
  "…and let go there, the room lands on it",
  (await pagerPage()) === 4 && (await dateLabel()) === pausedOn && (await byId("darkroom-glide-sheet").count()) === 0,
  `${await dateLabel()} · page ${await pagerPage()}`,
);
// Back to the second print, which the set-aside section reads.
await byId("darkroom-glide-cell-1").first().click();
await wait(800);
check("A frame tapped brings it back to the second print", (await dateLabel()) === secondDate && Math.abs((await stripLeft()) - 36) <= 1, await dateLabel());

// --- set aside ----------------------------------------------------------------------------
// Set aside, the word turns from faint to the room's full ink, beside the dot in the accent. The
// browser shows the light print, as the rest of the app does there: the ink is the paper's #2B2620.
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
check("SET ASIDE marks the print", before !== after && /43, 38, 32/.test(after), `${before} → ${after}`);

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
check(
  "Contents reads as an index: a heading over the ways in, and over the years, oldest first",
  /Ways in/.test(sheet) &&
    /By year/.test(sheet) &&
    /Oldest first/.test(sheet) &&
    (await seen(page.locator('[data-testid="darkroom-contents-ways-in"][role="heading"]')).count()) === 1 &&
    (await seen(page.locator('[data-testid="darkroom-contents-by-year"][role="heading"]')).count()) === 1,
);
const ribbon = await box("darkroom-contents-here");
const dayLine = await box("darkroom-contents-on-this-day");
const dayTitleInk = await page.evaluate(() => {
  const line = [...document.querySelectorAll('[data-testid="darkroom-contents-on-this-day"]')].find((e) => e.offsetParent !== null);
  const title = line ? [...line.querySelectorAll("div")].find((d) => d.children.length === 0 && d.textContent === "On this day") : null;
  return title ? getComputedStyle(title).color : "";
});
// (VoiceOver hears it as selected; React Native for the web does not carry that state to the page.)
check(
  "Where you are is marked: the ribbon beside On this day, and its title in the accent",
  ribbon != null &&
    dayLine != null &&
    ribbon.height >= 20 &&
    ribbon.right <= dayLine.x + 24 &&
    Math.abs(ribbon.y + ribbon.height / 2 - (dayLine.y + dayLine.height / 2)) <= 4 &&
    dayTitleInk === LIGHT_ACCENT &&
    (await seen(page.locator('[data-testid="darkroom-contents-here"]')).count()) === 1,
  `${dayTitleInk} ${JSON.stringify({ ribbon, dayLine })}`,
);
await shot("contents");

// --- a year, and its months -------------------------------------------------------------------
const chosenYear = yearTitles[Math.min(2, yearTitles.length - 1)];
await yearLines.nth(Math.min(2, yearCount - 1)).click();
await wait(2600);
check("A year opens as a chapter", (await chapterHead()) === String(chosenYear), await chapterHead());
check("…with POST under its photograph", await postShown(), await postSays());
await shot("year-chapter");
// light.inkFaint, #9C927F: the print's firm line.
check(
  "Once Contents has been opened, the line under CONTENTS is put away, and the tab ruled in the firm line",
  (await byId("darkroom-contents-invite").count()) === 0 && (await style("darkroom-contents-tab", "borderTopColor")) === "rgb(156, 146, 127)",
  await style("darkroom-contents-tab", "borderTopColor"),
);
const yearLine = ((await byId("darkroom-caption-line").first().textContent().catch(() => "")) ?? "").trim();
check("The year’s caption gives the weekday", /^A (Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day\b/.test(yearLine), yearLine || (await text()).slice(0, 300));

await openContents();
await wait(1400);
const months = seen(page.locator('[data-testid^="darkroom-month-"]'));
check("The open year shows its twelve months", (await months.count()) === 12);
check(
  "…under a heading of their own",
  ((await byId("darkroom-months-head").first().textContent().catch(() => "")) ?? "").trim() === `The months of ${chosenYear}`,
);
await shot("months");
const filled = seen(page.locator('[data-testid^="darkroom-month-"]:not([aria-disabled="true"])'));
const filledCount = await filled.count();
check("Months with photographs can be chosen; empty ones cannot", filledCount > 0 && filledCount < 12, `${filledCount} of 12`);
await filled.nth(filledCount - 1).click();
await wait(2600);
check("A month opens the year from that month", (await chapterHead()) === String(chosenYear) && (await dateLabel()) !== "");
const yearFrames = await stripFrames();
const yearPages = await page.evaluate(() => {
  const lists = [...document.querySelectorAll('[data-testid="darkroom-pager"]')].filter((e) => e.offsetParent !== null);
  const list = lists[lists.length - 1];
  return list ? Math.round(list.scrollWidth / list.clientWidth) : -1;
});
const monthMark = ((await byId("darkroom-glide-mark-0").first().textContent().catch(() => "")) ?? "").trim();
check(
  "A year has the strip too: a frame for each photograph dealt and the blank one, its months along the edge",
  (await appears("darkroom-glide-strip-row", 2000)) && yearFrames === yearPages && yearFrames >= 2 && /^[A-Z]{3}$/.test(monthMark),
  `${yearFrames} frames · ${yearPages} pages · ${monthMark}`,
);
await shot("year");

// --- Surprise me -----------------------------------------------------------------------------------
await openContents();
await wait(900);
await byId("darkroom-contents-surprise-me").first().click();
await wait(2800);
const surprise = await text();
check("Surprise me deals an older photograph", /surprise me/i.test(await chapterHead()) && /(years ago|Last year)/.test(surprise));
check("…with POST under it", await postShown(), await postSays());
check("Surprise me has the strip, with nothing printed along it", (await appears("darkroom-glide-strip-row", 2000)) && (await marksShown()) === 0);
await shot("surprise");
// Glided onto the blank frame at the end of what has been dealt: the next few are dealt meanwhile, and the room
// comes to rest on a photograph or on the roll's waiting card — never stuck.
const dealt0 = await stripFrames();
await glideTo((dealt0 - 1) * 36);
const dealtOn = await until(async () => (await stripFrames()) > dealt0, 4000, 50);
await wait(1500);
const restsOn = (await dateLabel()) !== "" || /Looking through your library/.test(await text());
check(
  "Gliding toward the end of a roll deals on, and the room comes to rest",
  dealtOn && restsOn && (await byId("darkroom-glide-sheet").count()) === 0,
  `${dealt0} → ${await stripFrames()} frames · ${await dateLabel()}`,
);
check(
  "…with POST under the photograph it rests on, and none over the waiting card",
  (await dateLabel()) !== "" ? await postShown() : (await seenOpacity("darkroom-develop")) === 0,
  `${await dateLabel()} · ${await seenOpacity("darkroom-develop")}`,
);
await shot("surprise-dealt");
await byId("darkroom-glide-cell-0").first().click();
await wait(800);

// --- Set aside ---------------------------------------------------------------------------------------
await openContents();
await wait(900);
await byId("darkroom-contents-set-aside").first().click();
await wait(2200);
const shelfWord = ((await byId("darkroom-caption-word").first().textContent().catch(() => "")) ?? "").trim();
check("The shelf opens as its own chapter, with PUT BACK", /set aside/i.test(await chapterHead()) && /put back/i.test(shelfWord), shelfWord);
check("The shelf has the strip, with nothing printed along it", (await appears("darkroom-glide-strip-row", 2000)) && (await marksShown()) === 0);
check("…and POST under its photograph", await postShown(), await postSays());
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
await wait(300);
await shot("end");
const endWords = await seen(page.locator('[data-testid^="darkroom-word-"]')).evaluateAll((els) =>
  els.map((e) => ({ id: e.getAttribute("data-testid"), text: (e.textContent ?? "").trim() })),
);
check("Its first word hands on, and nothing says play", endWords.length > 0 && endWords[0]?.id !== "darkroom-word-play" && !/play/i.test(JSON.stringify(endWords)), JSON.stringify(endWords));
check(
  "On the end page the strip stays, its blank frame under the box, and POST has gone",
  Math.abs((await stripLeft()) - 216) <= 1 && (await seenOpacity("darkroom-glide-box")) === 1 && (await seenOpacity("darkroom-develop")) === 0,
  `${await stripLeft()} · box ${await seenOpacity("darkroom-glide-box")} · develop ${await seenOpacity("darkroom-develop")}`,
);
await byId("darkroom-glide-cell-0").first().click();
await wait(800);
check("A frame from the end page goes back to the first photograph", (await dateLabel()) === firstDate, await dateLabel());

// --- POST, back from the end page --------------------------------------------------------------------------
// The ways back that lost the word on the phone in build 58: it stayed at nothing on every photograph after.
check("…and POST is under it again", await postShown(), await postSays());
await turn(1);
check("…and on the next photograph, swiped to", await postShown(), `${await dateLabel()} · ${await postSays()}`);
await toEnd();
await turn(-1);
check("Swiped back from the end page, POST is under the last photograph", (await dateLabel()) !== "" && (await postShown()), await postSays());
await turn(-1);
check("…and under the one before it", await postShown(), await postSays());
await toEnd();
// Two frames back: a cut further than the pages the browser has drawn lands among its unrendered spacer, which
// has no snap points there, and snaps back to the first (the phone has no such limit).
await glideTo(144);
await wait(1500);
check("Glided back from the end page, POST is under the photograph the glide landed on", (await pagerPage()) === 4 && (await postShown()), `${await pagerPage()} · ${await postSays()}`);
await tapPlate(0.85);
check("…and stays as the pages turn on", await postShown(), await postSays());
await toEnd();

// --- POST into the editor, and back --------------------------------------------------------------------
await turn(-1);
const developed = await dateLabel();
await byId("darkroom-develop").first().click();
await wait(4500);
const editor = await text();
check("POST opens the existing editor", /Share to VINTAGE/.test(editor) && /Film|FILM/.test(editor));
check("The editor knows when the shutter fired", /Read from the file/.test(editor));
await shot("editor");
await page.goBack();
await wait(2200);
check("Back from the editor, the room is as it was, POST and all", (await dateLabel()) === developed && (await postShown()), `${developed} · ${await postSays()}`);

// --- a 320-point phone ----------------------------------------------------------------------------------
const small = await phone(320, 568);
await signIn(small);
await enterRoom(small);
await small.waitForTimeout(800);
const smallBoxes = await small.evaluate(() => {
  const boxOf = (id) => {
    const el = [...document.querySelectorAll(`[data-testid="${id}"]`)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.left >= -1 && r.left < window.innerWidth;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
  };
  return {
    strip: boxOf("darkroom-glide-strip-row"),
    caption: boxOf("darkroom-caption"),
    develop: boxOf("darkroom-develop"),
    scrollWidth: document.documentElement.scrollWidth,
  };
});
const sb = smallBoxes;
check(
  "On a 320-point phone the caption, POST and the strip stand in that order, clear of each other, and nothing runs off the page",
  sb.strip != null &&
    sb.caption != null &&
    sb.develop != null &&
    sb.caption.bottom <= sb.develop.y &&
    Math.abs(sb.strip.y - sb.develop.bottom - 12) <= 1 &&
    sb.develop.x >= 0 &&
    sb.develop.right <= 320 &&
    sb.strip.x >= 15.5 &&
    sb.strip.right <= 304.5 &&
    Math.abs(568 - sb.strip.bottom - 20) <= 1 &&
    sb.scrollWidth <= 320,
  JSON.stringify(sb),
);
if (out) await small.screenshot({ path: `${out}/darkroom-${String(++shots).padStart(2, "0")}-phone-320.png` });
// Glided to the third photograph, upright, under which SET ASIDE has no room beside the date and takes a line of
// its own: the preview stands it as its page will, so the landing does not shrink it.
const thirdOn320 = await boxOn(small, "darkroom-glide-cell-2");
await glideOn(small, 72);
const smallPreviewing = await (async () => {
  for (let t = 0; t <= 120; t += 10) {
    if ((await seenOpacityOn(small, "darkroom-glide-sheet")) > 0.99) return true;
    await small.waitForTimeout(10);
  }
  return false;
})();
await small.waitForTimeout(40);
const smallPreview = await previewOn(small);
const ownRow = await small.evaluate(() => {
  const date = [...document.querySelectorAll('[data-testid="darkroom-glide-caption-date"]')].find((e) => e.getBoundingClientRect().width > 0);
  const word = [...document.querySelectorAll('[data-testid="darkroom-glide-caption-word"]')].find((e) => e.getBoundingClientRect().width > 0);
  // Each press reaches over the space around it, so the rows are told apart by their middles.
  const mid = (e) => {
    const r = e.getBoundingClientRect();
    return r.top + r.height / 2;
  };
  return date && word ? mid(word) > mid(date) + 8 : null;
});
await small.waitForTimeout(1500);
const smallLanded = await pageOn(small);
check(
  "On a 320-point phone a glide lands just where its preview stood the photograph and caption",
  thirdOn320 != null && smallPreviewing && ownRow === true && standsAlike(smallPreview, smallLanded),
  JSON.stringify({ smallPreviewing, ownRow, smallPreview, smallLanded }),
);

console.log("\nJS errors:", errors.length ? errors.slice(0, 10) : "none");
check("No page errors", errors.length === 0);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log("FAILED: " + failed.map((r) => r.name).join(" | "));
await browser.close();
process.exit(failed.length ? 1 : 0);
