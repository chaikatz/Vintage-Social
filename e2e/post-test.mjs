// The Post tab, walked through the real interface in the demo web build:
// the doors (the Memory Room, On this day), the selected photograph on the
// camera's mount with its signature line and POST, RECENT with SHORT VIDEO
// and LIBRARY, the roll and its foot → a photograph tapped, selected and
// seen large → POST into the editor, and back to the same one → the
// selected cell tapped again → the end of the roll → a cell tapped from far
// down brings the mount back → the two pickers → On this day and the room
// → SET ASIDE · 1 under the doors, into the shelf → the Post tab tapped
// again → a 320-point phone.
//
//   npm run build:web && node e2e/serve.mjs & node e2e/post-test.mjs     (SHOT_DIR=… to keep screenshots)
//
// E2E_BASE points it at a build served elsewhere (the default is e2e/serve.mjs's);
// E2E_W and E2E_H set the phone (393 × 852 by default).
//
// The browser build reads the room's small bundled demo library
// (src/darkroom/demoSource.ts): about thirty photographs, the newest some
// hundred days old, six of them on today's date in earlier years. It has no
// camera, so the roll has no camera tile, and LIBRARY and SHORT VIDEO open
// the browser's file chooser. Demo state lives in the page, so after
// signing in everything is reached by tapping, never by loading a URL,
// except the first visit to the tab.
import { chromium } from "playwright";

const out = process.env.SHOT_DIR ?? null;
const B = process.env.E2E_BASE ?? "http://127.0.0.1:8090";
const W = Number(process.env.E2E_W ?? 393);
const H = Number(process.env.E2E_H ?? 852);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
/** A phone of this size, as the browser draws it. */
const phone = async (width, height) => {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: out ? 2 : 1,
    isMobile: true,
    hasTouch: true,
  });
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/ERR_|Failed to load resource|no supported source/.test(m.text())) errors.push("console: " + m.text());
  });
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
const byId = (id, p = page) => seen(p.locator(`[data-testid="${id}"]`));
let shots = 0;
const shot = async (name, p = page) => {
  shots += 1;
  if (out) await p.screenshot({ path: `${out}/post-${String(shots).padStart(2, "0")}-${name}.png` });
};
const text = async (p = page) => ((await p.textContent("body")) ?? "").replace(/\s+/g, " ");
const appears = async (id, timeout = 8000, p = page) =>
  p
    .locator(`[data-testid="${id}"]`)
    .locator("visible=true")
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
const textOf = async (id, p = page) => ((await byId(id, p).first().textContent().catch(() => "")) ?? "").trim();
/** Where a view stands on the phone: the one on screen. */
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
const box = (id) => boxOn(page, id);
/** The roll's own scroll: set, as a finger's would leave it. */
const scrollRoll = (p, y) =>
  p.evaluate((top) => {
    const roll = [...document.querySelectorAll('[data-testid="post-roll"]')].find((e) => e.getBoundingClientRect().width > 0);
    if (!roll) return -1;
    roll.scrollTop = top === "end" ? roll.scrollHeight : top;
    return roll.scrollTop;
  }, y);
const rollTop = (p = page) =>
  p.evaluate(() => {
    const roll = [...document.querySelectorAll('[data-testid="post-roll"]')].find((e) => e.getBoundingClientRect().width > 0);
    return roll ? roll.scrollTop : -1;
  });
/** Which of the roll's cells on screen is selected, by its place in the roll. */
const selectedCell = (p = page) =>
  p.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid="post-cell"]')].filter((e) => e.getBoundingClientRect().width > 0);
    return cells.findIndex((c) => c.getAttribute("aria-selected") === "true");
  });
const cell = (i, p = page) => seen(p.locator('[data-testid="post-cell"]')).nth(i);

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
/**
 * Back, as the app's own back button takes it — the iPhone's back. The
 * browser's back button reloads the navigator from the address instead, which
 * makes every page afresh and is not what a member does.
 */
const appBack = async (p = page, ms = 1800) => {
  // The stack's header draws its back as a link named "Go back"; the room's is a button named "Back".
  const button = seen(p.locator('[aria-label="Go back"], [aria-label="Back"]')).first();
  if (await button.count()) await button.click();
  else await p.goBack();
  await p.waitForTimeout(ms);
};
/** The tab bar's Post, confirmed by aria-selected. */
const postTab = async (p = page, ms = 1600) => {
  await seen(p.locator('[role="tab"]')).nth(2).click();
  await p
    .waitForFunction(() => document.querySelectorAll('[role="tab"]')[2]?.getAttribute("aria-selected") === "true", null, { timeout: 10000 })
    .catch(() => {});
  await p.waitForTimeout(ms);
};

// --- 1. the page ---------------------------------------------------------------------------------
await signIn(page);
await page.goto(B + "/create", { waitUntil: "networkidle" });
await wait(2200);
await appears("post-hero", 8000);
await wait(600);
const words = await text();
check(
  "The Post tab names its doors, its roll and its ways in",
  ["The Memory Room", "On this day", "Recent", "Short video", "Library", "Post"].every((w) => words.includes(w)),
);
check("…and no longer carries its old headline or its empty eyebrow", !/Share a photograph\./.test(words) && !/Today in other years/i.test(words));
await shot("full");

// --- 2. the mount, the roll and the day door ------------------------------------------------------------
const firstDate = await textOf("post-hero-date");
check("The mount's signature line is the photograph's date in capitals", /^[A-Z]+ \d{1,2}, \d{4}$/.test(firstDate), firstDate);
check("…and how long ago, in words", /ago$|^Today$|^Yesterday$/.test(await textOf("post-hero-age")), await textOf("post-hero-age"));
const cells = await seen(page.locator('[data-testid="post-cell"]')).count();
check("The roll shows at least three rows of photographs", cells >= 12, String(cells));
check("There is no camera tile in the browser", (await page.locator('[data-testid="post-camera"]').count()) === 0);
const dayDoor = await textOf("post-door-day");
check("On this day counts the demo's six anniversaries, and their years", /6 photographs/.test(dayDoor) && /\d{4} – \d{4}/.test(dayDoor), dayDoor);
check("The newest photograph is the one selected", (await selectedCell()) === 0);
const hero = await box("post-hero");
const post = await box("post-post");
check(
  "POST stands in the strip under the photograph, inside the mount",
  hero != null && post != null && post.y > hero.y + hero.height / 2 && post.bottom <= hero.bottom + 0.5 && post.right <= W - 15,
  JSON.stringify({ hero, post }),
);
const frame = await box("post-hero-photo");
check(
  "The photograph stands on the mount, within its inset, never wider than the phone less the mount",
  frame != null && hero != null && frame.x >= 11.5 && frame.right <= W - 11.5 && frame.y >= hero.y + 11.5 && frame.bottom <= hero.bottom - 50,
  JSON.stringify(frame),
);

// --- 3. a photograph tapped ------------------------------------------------------------------------------
await cell(2).click();
await wait(700);
const thirdDate = await textOf("post-hero-date");
check("A photograph tapped is shown large, by its own date", thirdDate !== firstDate && /^[A-Z]+ \d{1,2}, \d{4}$/.test(thirdDate), `${firstDate} → ${thirdDate}`);
check("…and wears the box", (await selectedCell()) === 2);
await shot("selected");

// --- 4. POST into the editor, and back -----------------------------------------------------------------------
await byId("post-post").first().click();
await page.waitForURL(/\/compose/, { timeout: 10000 }).catch(() => {});
await wait(2500);
const editor = await text();
check("POST opens the editor on the photograph", /\/compose/.test(page.url()) && /Share to VINTAGE/.test(editor), page.url());
const drawn = await page.evaluate(() =>
  [...document.querySelectorAll("img, canvas")].some((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 150 && r.height > 100 && r.top < window.innerHeight;
  }),
);
check("…which shows the photograph", drawn);
await shot("editor");
await appBack(page, 2000);
check("Back from the editor, the same photograph is selected", (await selectedCell()) === 2 && (await textOf("post-hero-date")) === thirdDate, await textOf("post-hero-date"));

// --- 5. the selected photograph tapped again -------------------------------------------------------------------
await wait(500);
await cell(2).click();
await page.waitForURL(/\/compose/, { timeout: 10000 }).catch(() => {});
await wait(1800);
check("The selected photograph tapped again opens the editor", /\/compose/.test(page.url()), page.url());
await appBack(page, 2000);

// --- 6. the end of the roll -----------------------------------------------------------------------------------
await scrollRoll(page, "end");
await wait(1200);
await scrollRoll(page, "end");
await wait(800);
const footer = await box("post-footer");
check(
  "At the end of the roll, the Memory Room hands on",
  footer != null && footer.y < H && /Enter the Memory Room/.test(await textOf("post-footer")) && /Further back/i.test(await textOf("post-footer")),
  JSON.stringify(footer),
);
await shot("scrolled");

// --- 7. a cell tapped from far down brings the mount back -------------------------------------------------------
const down = await scrollRoll(page, 700);
await wait(600);
const visibleCell = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-testid="post-cell"]')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.top > 80 && r.bottom < window.innerHeight - 80 && e.getAttribute("aria-selected") !== "true";
  });
  return cells.length ? [...document.querySelectorAll('[data-testid="post-cell"]')].filter((e) => e.getBoundingClientRect().width > 0).indexOf(cells[0]) : -1;
});
if (visibleCell >= 0) await cell(visibleCell).click();
await wait(1200);
const heroBack = await box("post-hero");
check(
  "A photograph tapped far down the roll is brought up to the mount",
  down > 400 && visibleCell >= 0 && heroBack != null && heroBack.y >= 0 && heroBack.bottom <= H && (await rollTop()) < 5,
  JSON.stringify({ down, visibleCell, heroBack, top: await rollTop() }),
);

// --- 8. the two pickers ------------------------------------------------------------------------------------------
// Each is let go with nothing chosen, as a member who cancels the picker does, and the page rests again.
const chooser = async (name) => {
  const wanted = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
  await seen(page.getByRole("button", { name })).first().click();
  const opened = await wanted;
  if (opened) await opened.setFiles([]);
  await wait(800);
  return opened != null;
};
check("LIBRARY opens the browser's own chooser", await chooser(/^Library$/));
check("SHORT VIDEO opens it too", await chooser(/^Short video$/));
check("…and a picker let go with nothing chosen leaves the page as it was", !(await byId("post-post").first().isDisabled()));

// --- 9. the doors -------------------------------------------------------------------------------------------------
await byId("post-door-day").first().click();
await wait(2200);
check("On this day opens On this day", /\/memories/.test(page.url()) && /On this day/.test(await text()), page.url());
await appBack(page);
await byId("post-door-room").first().click();
const firstVisit = await appears("darkroom-page-firstVisit", 8000);
check("The Memory Room's door opens the room's first-visit page", firstVisit);
await shot("room");

// --- 10. SET ASIDE · 1 -----------------------------------------------------------------------------------------------
await byId("darkroom-word-enter").first().click();
await appears("darkroom-caption-date", 10000);
await wait(900);
await byId("darkroom-caption-word").first().click();
await wait(700);
await appBack(page, 1500);
await postTab();
const shelfWords = await textOf("post-shelf");
// Its words, then its arrow (a glyph of the icon font).
check("SET ASIDE · 1 stands under the doors", /^set aside · 1(?!\d)/i.test(shelfWords), shelfWords);
await shot("shelf");
await byId("post-shelf").first().click();
await wait(2500);
const head = ((await byId("darkroom-chapter").first().textContent().catch(() => "")) ?? "").trim();
check("…and opens the shelf", /set aside/i.test(head), head);
await appBack(page, 1500);
await postTab();

// --- 11. Post, tapped again ---------------------------------------------------------------------------------------------
await cell(3).click();
await wait(500);
await scrollRoll(page, 600);
await wait(500);
await postTab(page, 1400);
check("The Post tab tapped again goes back to the top, with the newest selected", (await rollTop()) < 5 && (await selectedCell()) === 0, `top ${await rollTop()} · ${await selectedCell()}`);

// --- 12. a 320-point phone ---------------------------------------------------------------------------------------------
const small = await phone(320, 568);
await signIn(small);
await small.goto(B + "/create", { waitUntil: "networkidle" });
await small.waitForTimeout(2200);
await appears("post-hero", 8000, small);
await small.waitForTimeout(600);
const narrow = await small.evaluate(() => {
  const inDoor = (id) => {
    const el = [...document.querySelectorAll(`[data-testid="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0);
    return el ? el.querySelectorAll("img").length : -1;
  };
  return { scrollWidth: document.documentElement.scrollWidth, room: inDoor("post-door-room"), day: inDoor("post-door-day") };
});
check("Nothing runs off the side of a 320-point phone", narrow.scrollWidth <= 320, String(narrow.scrollWidth));
check("…where the doors keep their words and let their pictures go", narrow.room === 0 && narrow.day === 0, JSON.stringify(narrow));
const smallPost = await boxOn(small, "post-post");
check("…and POST is in view without scrolling", smallPost != null && smallPost.bottom <= 568 - 44 && smallPost.y > 0, JSON.stringify(smallPost));
const smallWays = await small.evaluate(() =>
  ["Recent", "Short video", "Library"].every((w) =>
    [...document.querySelectorAll("body *")].some((d) => {
      const r = d.getBoundingClientRect();
      return d.children.length === 0 && d.textContent?.trim() === w && r.width > 0 && r.right <= 320 && r.bottom <= 568 - 44;
    }),
  ),
);
check("…with RECENT, SHORT VIDEO and LIBRARY on one line in view", smallWays);
await shot("320", small);

// --- 13. ---------------------------------------------------------------------------------------------------------------
check("No page errors", errors.length === 0, errors.slice(0, 5).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
