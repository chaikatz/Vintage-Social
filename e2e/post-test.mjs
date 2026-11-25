// The Post tab, walked through the real interface in the demo web build:
// the doors (the Memory Room, On this day), the selected photograph on the
// camera's mount with its signature line and POST, RECENT with SHORT VIDEO
// and LIBRARY, the roll and its foot → a photograph tapped, selected and
// seen large → POST into the editor, and back to the same one → the
// selected cell tapped again → the end of the roll → a cell tapped from far
// down brings the mount back → the two pickers → On this day and the room
// → SET ASIDE · 1 under the doors, into the shelf → the Post tab tapped
// again → a 320-point phone → the doors and the roll as the tab rests: sent
// to the background, left for another tab, and the selection after a
// minute and after three hours away.
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
const phone = async (width, height, clock = false) => {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: out ? 2 : 1,
    isMobile: true,
    hasTouch: true,
  });
  const p = await context.newPage();
  // A clock the walk can move on, for the time away from the tab.
  if (clock) await p.clock.install();
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

/** The doors as they stand: their size, the size of their words, and how many photographs they carry. */
const doors = (p = page) =>
  p.evaluate(() => {
    const on = (id) =>
      [...document.querySelectorAll(`[data-testid="${id}"]`)].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0;
      });
    const one = (id) => {
      const el = on(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const words = [...el.querySelectorAll("div")].filter((d) => d.children.length === 0 && (d.textContent ?? "").trim().length > 0);
      return {
        height: Math.round(r.height),
        imgs: el.querySelectorAll("img").length,
        words: words.map((d) => {
          const w = d.getBoundingClientRect();
          return `${Math.round(w.left)}:${Math.round(w.width)}:${Math.round(w.height)}`;
        }),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    };
    const hero = on("post-hero") ?? on("post-panel");
    return { room: one("post-door-room"), day: one("post-door-day"), heroY: hero ? Math.round(hero.getBoundingClientRect().top) : null };
  });
/** The roll's cells on the screen with their photograph drawn, and every cell's photograph drawn at all. */
const drawnNow = (p = page) =>
  p.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid="post-cell"]')].filter((e) => e.getBoundingClientRect().width > 0);
    const inView = cells.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight - 60;
    });
    const has = (c) => [...c.querySelectorAll("img")].some((i) => i.getAttribute("src"));
    const hero = [...document.querySelectorAll('[data-testid="post-hero"]')].find((e) => e.getBoundingClientRect().width > 0);
    return {
      inView: inView.length,
      inViewDrawn: inView.filter(has).length,
      all: cells.length,
      allDrawn: cells.filter(has).length,
      hero: hero ? hero.querySelectorAll("img").length : -1,
    };
  });
/** The page sent to the background, or brought back, as the phone's home gesture does. */
const visibility = (p, hidden) =>
  p.evaluate((h) => {
    Object.defineProperty(document, "hidden", { value: h, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: h ? "hidden" : "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
// As the page comes up its faces arrive — the roll, then On this day's count — and nothing moves.
const seenDoors = [];
for (let i = 0; i < 40; i++) {
  seenDoors.push(await doors());
  await wait(60);
}
await wait(400);
await appears("post-hero", 8000);
await wait(600);
const settled = await doors();
const heights = new Set(seenDoors.filter((d) => d.day && d.room).flatMap((d) => [d.day.height, d.room.height]));
const heroYs = new Set(seenDoors.map((d) => d.heroY).filter((y) => y != null));
check(
  "The doors keep one height while their faces arrive, and the mount under them never moves",
  heights.size === 1 && heights.has(settled.day.height) && heroYs.size === 1 && heroYs.has(settled.heroY),
  JSON.stringify({ heights: [...heights], heroYs: [...heroYs], faces: [...new Set(seenDoors.map((d) => d.day?.text))] }),
);
// The longest faces the door may be given — a count in the thousands, the member's own post's
// sentence — set into it in place of the demo's: the door, and everything under it, stays put.
const longFaces = await page.evaluate(() => {
  const door = [...document.querySelectorAll('[data-testid="post-door-day"]')].find((e) => e.getBoundingClientRect().width > 0);
  const hero = [...document.querySelectorAll('[data-testid="post-hero"]')].find((e) => e.getBoundingClientRect().width > 0);
  const line = door && [...door.querySelectorAll("div")].find((d) => d.children.length === 0 && /photograph/.test(d.textContent ?? ""));
  if (!door || !hero || !line) return null;
  // The fan's years, under its count; the member's post has none.
  const sub = [...door.querySelectorAll("div")].find((d) => d.children.length === 0 && /\d{4}/.test(d.textContent ?? ""));
  const was = line.textContent;
  const out = [];
  for (const [words, years] of [
    ["1,204 photographs", true],
    ["12 years ago today, you were in Lisbon.", false],
  ]) {
    line.textContent = words;
    if (sub) sub.style.display = years ? "" : "none";
    out.push({ words, lines: Math.round(line.getBoundingClientRect().height / 17), door: Math.round(door.getBoundingClientRect().height), hero: Math.round(hero.getBoundingClientRect().top) });
  }
  line.textContent = was;
  if (sub) sub.style.display = "";
  return out;
});
check(
  "…and the longest faces it may be given leave the door, and the page under it, where they were",
  longFaces != null && longFaces.every((f) => f.door === settled.day.height && f.hero === settled.heroY),
  JSON.stringify({ longFaces, door: settled.day.height, hero: settled.heroY }),
);
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

// --- 3b. sent to the background, and back ----------------------------------------------------------------
const frontDoors = await doors();
const frontDrawn = await drawnNow();
await visibility(page, true);
await wait(400);
const awayDoors = await doors();
const awayDrawn = await drawnNow();
check(
  "In the background the doors are as they were: the same prints, the same words in the same place",
  same(frontDoors, awayDoors) && frontDoors.day.imgs > 0,
  JSON.stringify({ front: frontDoors.day, away: awayDoors.day }),
);
check(
  "…the photographs on the screen and the mount stay drawn",
  awayDrawn.inView > 0 && awayDrawn.inViewDrawn === awayDrawn.inView && awayDrawn.hero === frontDrawn.hero && frontDrawn.hero >= 1,
  JSON.stringify({ frontDrawn, awayDrawn }),
);
check("…and those out of sight are let go", awayDrawn.allDrawn < frontDrawn.allDrawn, JSON.stringify({ frontDrawn, awayDrawn }));
await visibility(page, false);
await wait(1200);
const backDrawn = await drawnNow();
check(
  "Back in front, every photograph is drawn again, and the selection is where it was",
  backDrawn.allDrawn === frontDrawn.allDrawn && (await selectedCell()) === 2 && same(await doors(), frontDoors),
  JSON.stringify(backDrawn),
);

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

// --- 13. the tab at rest, on a clock the walk moves on ----------------------------------------------------------------
const rest = await phone(W, H, true);
await signIn(rest);
await postTab(rest, 2600);
await appears("post-hero", 8000, rest);
// Into the room and out, so its door carries the print left off on.
await byId("post-door-room", rest).first().click();
await appears("darkroom-page-firstVisit", 8000, rest);
await byId("darkroom-word-enter", rest).first().click();
await appears("darkroom-caption-date", 10000, rest);
await rest.waitForTimeout(900);
await appBack(rest, 1500);
await postTab(rest, 1800);
await rest.waitForTimeout(800);
await cell(2, rest).click();
await rest.waitForTimeout(700);
const restDoors = await doors(rest);
const restDrawn = await drawnNow(rest);
// Another tab, for longer than the tab waits before letting go of what is out of sight.
await seen(rest.locator('[role="tab"]')).nth(3).click();
await rest.waitForTimeout(600);
await rest.clock.fastForward("00:11");
await rest.waitForTimeout(400);
const leftDoors = await rest.evaluate(() => {
  const el = document.querySelector('[data-testid="post-door-day"]');
  const room = document.querySelector('[data-testid="post-door-room"]');
  return { day: el ? el.querySelectorAll("img").length : -1, room: room ? room.querySelectorAll("img").length : -1, text: (el?.textContent ?? "").replace(/\s+/g, " ").trim() };
});
check(
  "Left for another tab, the Post tab's doors keep their prints and their words",
  leftDoors.day === restDoors.day.imgs && leftDoors.room === restDoors.room.imgs && restDoors.room.imgs === 2 && leftDoors.text === restDoors.day.text,
  JSON.stringify({ leftDoors, was: { day: restDoors.day.imgs, room: restDoors.room.imgs } }),
);
await postTab(rest, 1200);
const restBack = await drawnNow(rest);
check(
  "…and back on it, the page is as it was, the same photograph selected",
  same(await doors(rest), restDoors) && restBack.allDrawn === restDrawn.allDrawn && (await selectedCell(rest)) === 2,
  JSON.stringify(restBack),
);
// A minute in the background keeps the selection; three hours give way to the newest.
await visibility(rest, true);
await rest.waitForTimeout(300);
await rest.clock.fastForward("01:00");
await visibility(rest, false);
await rest.waitForTimeout(1800);
check("A minute in the background keeps the photograph selected", (await selectedCell(rest)) === 2, String(await selectedCell(rest)));
await visibility(rest, true);
await rest.waitForTimeout(300);
await rest.clock.fastForward("03:00:00");
await visibility(rest, false);
await rest.waitForTimeout(2200);
check("Three hours in the background give way to the newest", (await selectedCell(rest)) === 0, String(await selectedCell(rest)));

// --- 14. ---------------------------------------------------------------------------------------------------------------
check("No page errors", errors.length === 0, errors.slice(0, 5).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
