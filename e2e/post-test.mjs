// The Post tab, walked through the real interface in the demo web build, as
// the owner's mock draws it: RECENT and MEMORY ROOM in the header; the
// selected photograph large on the paper with its date stamp; LIBRARY,
// VIDEO and POST → under it; the roll → the page measured against the mock
// at 390 points → a photograph tapped, selected and seen large, a landscape
// one standing in the middle of the same frame → POST into the editor (the
// stamp on), and back to the same one → the photograph itself tapped → the
// selected cell tapped again → a cell tapped from far down brings the
// frame back → LIBRARY and VIDEO → the Memory Room: MEMORY ROOM tapped, and
// back lands on Recent; a slow slide past half, by mouse and by finger; a
// short slide, a quick nudge, a vertical scroll and a diagonal drift that
// do not; the tabs' own pager held still while the tab is in front, and
// let go when it is left; once, however it is asked → the Post tab tapped
// again → the photograph library's every state (never asked, refused,
// limited, empty, failed, reading), the camera tile as the iPhone draws it
// → 320 and 440 points → the tab at rest: sent to the background, left for
// another tab, and the selection after a minute and after three hours.
//
//   npm run build:web && node e2e/serve.mjs & node e2e/post-test.mjs     (SHOT_DIR=… to keep screenshots)
//
// E2E_BASE points it at a build served elsewhere (the default is e2e/serve.mjs's);
// E2E_W and E2E_H set the phone (390 × 844 by default, the mock's).
//
// The browser build reads the room's small bundled demo library
// (src/darkroom/demoSource.ts): about thirty photographs, the newest some
// hundred days old. It has no camera, so the roll has no camera tile, and
// LIBRARY and VIDEO open the browser's file chooser; the clip's limit is
// written under the line, since the browser's picker has no trimmer. To see
// the states the demo cannot reach (access never asked, refused, limited; a
// library empty, failing, slow) and the iPhone's camera tile, the served
// bundle is patched in the browser only (page.route), as round 26's walks
// did; nothing in the build is changed. Demo state lives in the page, so
// after signing in everything is reached by tapping, never by loading a
// URL, except the first visit to the tab.
import { chromium } from "playwright";

const out = process.env.SHOT_DIR ?? null;
const B = process.env.E2E_BASE ?? "http://127.0.0.1:8090";
const W = Number(process.env.E2E_W ?? 390);
const H = Number(process.env.E2E_H ?? 844);
// The browser's own sideways swipe through its history is off: a finger slid across Search after
// the walk has gone back from the room would otherwise take the browser forward to the room again.
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--overscroll-history-navigation=0", "--disable-features=OverscrollHistoryNavigation"],
});
const errors = [];
let patched = 0;

/**
 * The bundle, patched in the browser for the states the demo cannot reach:
 * window.__acc forces what access there is, __ask what asking gives;
 * __lib makes the demo library empty, failing or slow; __iphone draws the
 * roll as the iPhone does, the camera first and no clip note.
 */
function patch(body) {
  const before = body;
  body = body.replace('_e.readAccess=async function(){return o()?"full":"unavailable"}', '_e.readAccess=async function(){return window.__acc??(o()?"full":"unavailable")}');
  body = body.replace(
    '_e.requestAccess=async function(){return o()?"full":"unavailable"}',
    '_e.requestAccess=async function(){window.__asked=(window.__asked||0)+1;if(window.__ask){window.__acc=window.__ask}return window.__ask??(o()?"full":"unavailable")}',
  );
  body = body.replace(
    "return{count:async(t,a)=>a?0:n(t.from,t.to).length,async page({range:t,first:a",
    'return{count:async(t,a)=>a?0:n(t.from,t.to).length,async page(q){const L=window.__lib;if(L==="fail")throw new Error("no");if(L==="slow")await new Promise(r=>setTimeout(r,6e4));if(L==="empty")return{prints:[],hasNextPage:!1};return this.__p(q)},async __p({range:t,first:a',
  );
  body = body.replace(
    /\(0,(\w+)\.rollRows\)\((\w+)\.prints,\{camera:(\w+),more:(\w+)\}\):\(0,(\w+)\.wellRows\)\(\{camera:(\w+)\}\)/,
    "(0,$1.rollRows)($2.prints,{camera:window.__iphone||$3,more:$4}):(0,$5.wellRows)({camera:window.__iphone||$6})",
  );
  body = body.replace(/([\w$]+)=\(0,([\w$]+)\.jsx\)\(([\w$]+)\.default,\{style:\[([\w$]+)\.note/, "$1=!window.__iphone&&(0,$2.jsx)($3.default,{style:[$4.note");
  if (body !== before) patched += 1;
  return body;
}

/** A phone of this size, as the browser draws it; `init` is set on window before the app starts. */
const phone = async (width, height, { clock = false, init = null } = {}) => {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: out ? 2 : 1,
    isMobile: true,
    hasTouch: true,
  });
  if (init) {
    await context.addInitScript((kv) => {
      for (const [k, v] of Object.entries(kv)) window[k] = v;
    }, init);
    await context.route("**/_expo/static/js/web/*.js", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: patch(await res.text()), headers: { ...res.headers(), "content-type": "application/javascript" } });
    });
  }
  const p = await context.newPage();
  // A clock the walk can move on, for the time away from the tab.
  if (clock) await p.clock.install();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/ERR_|Failed to load resource|no supported source/.test(m.text())) errors.push("console: " + m.text());
  });
  p.on("dialog", (d) => d.accept().catch(() => {}));
  return p;
};
const page = await phone(W, H);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const wait = (ms, p = page) => p.waitForTimeout(ms);
const seen = (l) => l.locator("visible=true");
const byId = (id, p = page) => seen(p.locator(`[data-testid="${id}"]`));
let shots = 0;
const shot = async (name, p = page) => {
  shots += 1;
  if (out) await p.screenshot({ path: `${out}/post-${String(shots).padStart(2, "0")}-${name}.png` });
};
const text = async (p = page) => ((await p.textContent("body")) ?? "").replace(/\s+/g, " ");
const path = (p = page) => new URL(p.url()).pathname;
const appears = async (id, timeout = 8000, p = page) =>
  p
    .locator(`[data-testid="${id}"]`)
    .locator("visible=true")
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
/** Where a view stands on the phone: the one on screen. */
const boxOn = (p, id) =>
  p.evaluate((testId) => {
    const el = [...document.querySelectorAll(`[data-testid="${testId}"]`)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.right > 1 && r.left < window.innerWidth - 1;
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
/** A cell tapped where it is, without the browser scrolling it into view first. */
const tapCell = async (i, p = page) => {
  const b = await cell(i, p).boundingBox();
  if (b) await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await wait(700, p);
};
/** The stamp on the frame's photograph, as drawn. */
const stampText = (p = page) =>
  p.evaluate(() => {
    const photo = [...document.querySelectorAll('[data-testid="post-hero-photo"]')].find((e) => e.getBoundingClientRect().width > 0);
    if (!photo) return null;
    const leaf = [...photo.querySelectorAll("div")].find((d) => d.children.length === 0 && /^\d{1,2} \d{1,2} ’\d\d$/.test((d.textContent ?? "").trim()));
    return leaf ? leaf.textContent.trim() : null;
  });
/** The selected photograph's date, as VoiceOver hears it in the frame. */
const heroLabel = (p = page) =>
  p.evaluate(() => [...document.querySelectorAll('[data-testid="post-hero-photo"]')].find((e) => e.getBoundingClientRect().width > 0)?.getAttribute("aria-label") ?? "");
/** The roll's cells on the screen with their photograph drawn, and every cell's photograph drawn at all. */
const drawnNow = (p = page) =>
  p.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid="post-cell"]')].filter((e) => e.getBoundingClientRect().width > 0);
    const inView = cells.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight - 60 && r.left >= 0 && r.left < window.innerWidth;
    });
    const has = (c) => [...c.querySelectorAll("img")].some((i) => i.getAttribute("src"));
    const hero = [...document.querySelectorAll('[data-testid="post-hero"]')].find((e) => e.getBoundingClientRect().width > 0);
    return { inView: inView.length, inViewDrawn: inView.filter(has).length, all: cells.length, allDrawn: cells.filter(has).length, hero: hero ? hero.querySelectorAll("img").length : -1 };
  });
/** The page sent to the background, or brought back, as the phone's home gesture does. */
const visibility = (p, hidden) =>
  p.evaluate((h) => {
    Object.defineProperty(document, "hidden", { value: h, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: h ? "hidden" : "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
/** Which tab the tab bar says is in front. */
const tabIndex = (p = page) => p.evaluate(() => [...document.querySelectorAll('[role="tab"]')].findIndex((t) => t.getAttribute("aria-selected") === "true"));
/** Where the door's page stands: 0 when Recent is shown, the phone's width when the door is. */
const pagerAt = (p = page) =>
  p.evaluate(() => {
    const door = [...document.querySelectorAll('[data-testid="post-door-page"]')][0];
    return door ? Math.round(window.innerWidth - door.getBoundingClientRect().left) : -1;
  });
const headerSelected = (p = page) =>
  p.evaluate(() => {
    const a = (id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute("aria-selected");
    return { recent: a("post-head-recent"), room: a("post-head-room") };
  });

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
/** A drag by mouse, step by step, `pause` ms between steps, then let go after `hold` ms. */
const mouseDrag = async (p, from, to, { steps = 24, pause = 25, hold = 150, during = null } = {}) => {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    if (pause) await p.waitForTimeout(pause);
  }
  if (hold) await p.waitForTimeout(hold);
  const seenDuring = during ? await during() : null;
  await p.mouse.up();
  await p.waitForTimeout(1500);
  return seenDuring;
};
/** The same by finger: the browser's own touch events, so the roll scrolls as the browser scrolls it. */
const touchDrag = async (p, from, to, { steps = 24, pause = 16 } = {}) => {
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await p.waitForTimeout(pause);
  }
  await touch("touchEnd");
  await cdp.detach();
  await p.waitForTimeout(1500);
};

// --- 1. the page --------------------------------------------------------------------------------------
await signIn(page);
await page.goto(B + "/create", { waitUntil: "networkidle" });
await appears("post-hero", 8000);
await wait(1200);
const words = await text();
check("The header names the two pages, Recent and Memory Room", /Recent/.test(words) && /Memory Room/.test(words));
check(
  "…the page says LIBRARY, VIDEO and POST, and nothing of the old doors",
  ["Library", "Video", "Post"].every((w) => words.includes(w)) &&
    !/Rediscover something worth sharing|Every year, on this date|Further back|Enter the Memory Room|Set aside ·|Short video/.test(words),
);
check("…and the page has no title of its own: the header's Post stays unseen", (await page.evaluate(() =>
  [...document.querySelectorAll("div")].some((d) => d.children.length === 0 && d.textContent === "Post" && getComputedStyle(d).opacity === "0"),
)));
const sel = await headerSelected();
check("Recent is the page you are on, to VoiceOver as to the eye", sel.recent === "true" && sel.room === "false", JSON.stringify(sel));
const inks = await page.evaluate(() => {
  const ink = (id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    const layers = el ? [...el.querySelectorAll("div")].filter((d) => d.children.length === 0) : [];
    return layers.map((d) => `${getComputedStyle(d).color}@${getComputedStyle(d).opacity}`);
  };
  return { recent: ink("post-head-recent"), room: ink("post-head-room") };
});
check(
  "…Recent in ink, Memory Room in the quieter ink (the soft ink on paper)",
  inks.recent.includes("rgb(43, 38, 32)@1") && inks.room.includes("rgb(110, 101, 90)@1") && inks.room.includes("rgb(43, 38, 32)@0"),
  JSON.stringify(inks),
);
const cells = await seen(page.locator('[data-testid="post-cell"]')).count();
check("The roll shows at least three rows of photographs", cells >= 12, String(cells));
check("There is no camera tile in the browser", (await page.locator('[data-testid="post-camera"]').count()) === 0);
check("The newest photograph is the one selected", (await selectedCell()) === 0);
const firstLabel = await heroLabel();
check("The frame's photograph is the selected one to VoiceOver, by its date and how long ago", /^Selected: [A-Z][a-z]+ \d{1,2}, \d{4}\. .+\.$/.test(firstLabel), firstLabel);
const firstStamp = await stampText();
check("It carries VINTAGE's date stamp, its capture date", /^\d{1,2} \d{1,2} ’\d\d$/.test(firstStamp ?? ""), String(firstStamp));
await shot("recent");

// --- 2. measured against the mock, at 390 -----------------------------------------------------------------
if (W === 390) {
  const g = await page.evaluate(() => {
    const on = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.left < innerWidth; });
    const r = (id) => { const e = on(id); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
    const glyphs = (id) => {
      // The words' own boxes: the leaves inside the button.
      const e = on(id);
      const leaf = e && [...e.querySelectorAll("div")].find((d) => d.children.length === 0 && (d.textContent ?? "").trim().length > 0);
      if (!leaf) return null;
      const b = leaf.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
    };
    const cells = [...document.querySelectorAll('[data-testid="post-cell"]')].filter((e) => e.getBoundingClientRect().width > 0).slice(0, 4).map((e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; });
    const box = on("post-cell-box");
    const border = box ? parseFloat(getComputedStyle(box).borderTopWidth) : -1;
    const note = r("post-clip-note");
    const noteHeight = note ? note.h + parseFloat(getComputedStyle(on("post-clip-note").parentElement).paddingBottom) : 0;
    return { recent: glyphs("post-head-recent"), room: glyphs("post-head-room"), frame: r("post-hero"), line: r("post-line"), library: glyphs("post-way-library"), post: r("post-post"), cells, border, noteHeight };
  });
  const near = (a, b, tol = 2) => a != null && Math.abs(a - b) <= tol;
  // The mock (owner/post-mock.png, 390 × 797, y from the top of the safe area).
  const middle = (w) => w.y + w.h / 2;
  check(
    "The header's words stand where the mock's do: centred on the band's middle (27.5), the pair centred on the phone",
    g.recent && g.room && near(middle(g.recent), 27.5) && near(middle(g.room), 27.5) && near((g.recent.x + g.room.right) / 2, 195),
    JSON.stringify({ recent: g.recent, room: g.room }),
  );
  check(
    "…20 points apart, the serif's widths being the browser's own",
    g.recent && g.room && near(g.room.x - g.recent.right, 20, 2.5),
    String(g.room && g.recent && g.room.x - g.recent.right),
  );
  check(
    "The photograph's frame is the mock's: 27, 56, 336 × 420",
    g.frame && near(g.frame.x, 27) && near(g.frame.y, 56) && near(g.frame.w, 336) && near(g.frame.h, 420),
    JSON.stringify(g.frame),
  );
  check(
    "The line under it is the mock's: LIBRARY from x 27, POST ending on the frame's edge, both centred at y 499",
    g.line && g.library && g.post && near(g.library.x, 27) && near(g.post.right, 363) && near(middle(g.line), 499) && near(g.line.y, 476),
    JSON.stringify({ line: g.line, library: g.library, post: g.post }),
  );
  check(
    "The roll is the mock's: from y 522 (and the browser's clip note), four cells 96 square at x 0, 98, 196, 294",
    g.cells.length === 4 && g.cells.every((c, i) => near(c.x, [0, 98, 196, 294][i]) && near(c.w, 96)) && near(g.cells[0].y - g.noteHeight, 522),
    JSON.stringify({ cells: g.cells, note: g.noteHeight }),
  );
  check("The selected cell's rust border is the mock's 3 points", g.border === 3, String(g.border));
}

// --- 3. a photograph tapped ---------------------------------------------------------------------------------
// The frame's full image is one view for every photograph: a new selection gives it a new source,
// which stops the last one's request, rather than a new view that would leave it running.
const fullBefore = await page.evaluateHandle(() => [...document.querySelectorAll('[data-testid="post-hero-full"]')].find((e) => e.getBoundingClientRect().width > 0) ?? null);
const frameBefore = await box("post-hero");
const lineBefore = await box("post-line");
await tapCell(2);
const thirdLabel = await heroLabel();
check("A photograph tapped is shown large, by its own date", thirdLabel !== firstLabel && /^Selected: /.test(thirdLabel), `${firstLabel} → ${thirdLabel}`);
check("…and wears the rust border", (await selectedCell()) === 2);
const fullKept = await fullBefore.evaluate((el) => el != null && el.isConnected && el.getBoundingClientRect().width > 0);
check("…in the same full-size image view, given the new photograph", fullKept);
const thirdStamp = await stampText();
// A landscape photograph stands in the middle of the same frame, and nothing under the frame moves.
const landscape = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-testid="post-cell"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top > 0 && r.bottom < window.innerHeight - 60; });
  return [...document.querySelectorAll('[data-testid="post-cell"]')].filter((e) => e.getBoundingClientRect().width > 0).indexOf(
    cells.find((c) => { const img = c.querySelector("img"); return img && img.naturalWidth > img.naturalHeight * 1.2; }) ?? null,
  );
});
if (landscape >= 0) {
  await tapCell(landscape);
  const frame = await box("post-hero");
  const photo = await box("post-hero-photo");
  const line = await box("post-line");
  check(
    "A landscape photograph stands at its own shape in the middle of the same frame, and nothing under it moves",
    photo && frame && photo.width > photo.height && Math.abs(photo.y - frame.y - (frame.bottom - photo.bottom)) < 1.5 &&
      Math.abs(frame.y - frameBefore.y) < 0.5 && Math.abs(frame.height - frameBefore.height) < 0.5 && Math.abs(line.y - lineBefore.y) < 0.5,
    JSON.stringify({ frame, photo, line }),
  );
  await shot("landscape");
  await scrollRoll(page, 0);
  await tapCell(2);
}
await shot("selected");

// --- 3b. sent to the background, and back ---------------------------------------------------------------------
const frontDrawn = await drawnNow();
await visibility(page, true);
await wait(400);
const awayDrawn = await drawnNow();
check(
  "In the background the photographs on the screen and the frame stay drawn",
  awayDrawn.inView > 0 && awayDrawn.inViewDrawn === awayDrawn.inView && awayDrawn.hero === frontDrawn.hero && frontDrawn.hero >= 1,
  JSON.stringify({ frontDrawn, awayDrawn }),
);
check("…and those out of sight are let go", awayDrawn.allDrawn < frontDrawn.allDrawn, JSON.stringify({ frontDrawn, awayDrawn }));
await visibility(page, false);
await wait(1200);
const backDrawn = await drawnNow();
check(
  "Back in front, every photograph is drawn again, the selection where it was, and the pager on Recent",
  backDrawn.allDrawn === frontDrawn.allDrawn && (await selectedCell()) === 2 && (await pagerAt()) === 0,
  JSON.stringify(backDrawn),
);

// --- 4. POST into the editor, and back ------------------------------------------------------------------------
await byId("post-post").first().click();
await page.waitForURL(/\/compose/, { timeout: 10000 }).catch(() => {});
await wait(2500);
const editorUrl = new URL(page.url());
check("POST opens the editor on the selected photograph", /\/compose/.test(editorUrl.pathname) && /Share to VINTAGE/.test(await text()), page.url());
const stampSwitch = await page.evaluate((said) => {
  const sw = [...document.querySelectorAll('[role="switch"]')].find((e) => /Date stamp/.test(e.getAttribute("aria-label") ?? ""));
  // The editor's preview draws the stamp only while the switch is on; the switch's row always names it.
  const drawn = [...document.querySelectorAll("div")].filter((d) => d.children.length === 0 && (d.textContent ?? "").trim() === said).length;
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')].map((i) => i.checked);
  return sw ? { label: sw.getAttribute("aria-label"), drawn, boxes } : null;
}, thirdStamp);
check(
  "…with the date stamp on, saying what the frame's stamp said",
  editorUrl.searchParams.get("stamp") === "on" && stampSwitch?.label.includes(thirdStamp ?? "?") && stampSwitch.drawn >= 2 && stampSwitch.boxes.includes(true),
  JSON.stringify({ stamp: editorUrl.searchParams.get("stamp"), stampSwitch, thirdStamp }),
);
await shot("editor");
await appBack(page, 2000);
check("Back from the editor, the same photograph is selected, on Recent", (await selectedCell()) === 2 && (await heroLabel()) === thirdLabel && path() === "/create");

// --- 5. the photograph itself, and the selected cell tapped again ----------------------------------------------
await byId("post-hero-photo").first().click();
await page.waitForURL(/\/compose/, { timeout: 10000 }).catch(() => {});
await wait(1800);
check("A tap on the photograph in the frame opens the editor on it", /\/compose/.test(page.url()) && new URL(page.url()).searchParams.get("assetId") != null, page.url());
await appBack(page, 2000);
await wait(500);
await tapCell(2);
await page.waitForURL(/\/compose/, { timeout: 10000 }).catch(() => {});
await wait(1800);
check("The selected photograph tapped again opens the editor", /\/compose/.test(page.url()), page.url());
await appBack(page, 2000);

// --- 6. a cell tapped from far down brings the frame back --------------------------------------------------------
await scrollRoll(page, "end");
await wait(1200);
const down = await scrollRoll(page, 700);
await wait(600);
const visibleCell = await page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-testid="post-cell"]')].filter((e) => e.getBoundingClientRect().width > 0);
  const c = all.find((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top > 80 && r.bottom < window.innerHeight - 80 && e.getAttribute("aria-selected") !== "true"; });
  return c ? all.indexOf(c) : -1;
});
if (visibleCell >= 0) await tapCell(visibleCell);
await wait(800);
const heroBack = await box("post-hero");
check(
  "A photograph tapped far down the roll is brought up to the frame",
  down > 400 && visibleCell >= 0 && heroBack != null && heroBack.y >= 0 && (await rollTop()) < 5,
  JSON.stringify({ down, visibleCell, heroBack, top: await rollTop() }),
);

// --- 7. LIBRARY and VIDEO ------------------------------------------------------------------------------------------
// Each is let go with nothing chosen, as a member who cancels the picker does, and the page rests again.
const chooser = async (name) => {
  const wanted = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
  await seen(page.getByRole("button", { name })).first().click();
  const opened = await wanted;
  if (opened) await opened.setFiles([]);
  await wait(800);
  return opened;
};
const library = await chooser(/^Library$/);
check("LIBRARY opens the browser's own chooser, for a photograph", library != null);
const video = await chooser(/^Short video$/);
check("VIDEO opens it too, for a clip", video != null);
check("…and a picker let go with nothing chosen leaves the page as it was", !(await byId("post-post").first().isDisabled()) && path() === "/create");

// --- 8. the Memory Room ----------------------------------------------------------------------------------------------
// MEMORY ROOM, tapped: the pager slides to the door's page, and the room opens over it.
await byId("post-head-room").first().click();
const firstVisit = await appears("darkroom-page-firstVisit", 8000);
check("Tapping Memory Room opens the room (its first-visit page)", firstVisit && path() === "/darkroom", path());
await shot("room");
await wait(1500);
await appBack(page, 2000);
check(
  "Back from the room lands on Recent: the pager put back while the room covered it",
  path() === "/create" && (await pagerAt()) === 0 && (await headerSelected()).recent === "true" && Math.abs(((await box("post-hero"))?.x ?? -99) - frameBefore.x) < 1,
  JSON.stringify({ path: path(), at: await pagerAt(), sel: await headerSelected(), hero: await box("post-hero") }),
);

// Short of the slide: a short drag, a quick nudge, a vertical scroll, a diagonal drift. None of them opens the room.
const mid = { x: Math.round(W * 0.85), y: 300 };
await mouseDrag(page, mid, { x: mid.x - 90, y: mid.y }, { steps: 12 });
check("A short slow drag to the left does not open the room", path() === "/create" && (await pagerAt()) === 0, `${path()} · ${await pagerAt()}`);
await mouseDrag(page, mid, { x: mid.x - 60, y: mid.y }, { steps: 3, pause: 0, hold: 0 });
check("…nor a quick nudge", path() === "/create" && (await pagerAt()) === 0, `${path()} · ${await pagerAt()}`);
await mouseDrag(page, { x: W / 2, y: 620 }, { x: W / 2 - 20, y: 300 }, { steps: 16 });
check("…nor a drag up the roll", path() === "/create" && (await pagerAt()) === 0, `${path()} · ${await pagerAt()}`);
await touchDrag(page, { x: W / 2, y: 650 }, { x: W / 2 - 30, y: 300 });
const scrolled = await rollTop();
check("…nor the roll scrolled by a finger, which scrolls it", path() === "/create" && (await pagerAt()) === 0 && scrolled > 100, `${path()} · ${await pagerAt()} · scrolled ${scrolled}`);
await scrollRoll(page, 0);
await wait(400);
// By finger, as a thumb drifts: as far sideways as down. (A mouse pressed on the photograph and let go
// on it is a tap to the browser, however far it went; a finger that moves scrolls the roll instead.)
await touchDrag(page, { x: W * 0.8, y: 300 }, { x: W * 0.8 - 150, y: 300 - 150 });
check("…nor a diagonal drift", path() === "/create" && (await pagerAt()) === 0, `${path()} · ${await pagerAt()}`);
await scrollRoll(page, 0);
await wait(400);
await mouseDrag(page, { x: W * 0.15, y: 300 }, { x: W * 0.15 + 250, y: 300 }, { steps: 20 });
check("A slide to the right does nothing: not the room, not another tab", path() === "/create" && (await tabIndex()) === 2 && (await pagerAt()) === 0);

// A slow slide past half: the page follows the finger, and the room opens.
const during = await mouseDrag(page, { x: W - 20, y: 300 }, { x: W - 20 - W * 0.62, y: 305 }, {
  steps: 30,
  pause: 30,
  hold: 300,
  during: async () => ({ hero: await box("post-hero"), at: await pagerAt(), sel: await headerSelected() }),
});
await shot("slide-midway");
check(
  "A slow slide to the left moves Recent with the finger…",
  during && during.at > W * 0.5 && during.hero && during.hero.x < 0,
  JSON.stringify(during),
);
const slid = await appears("darkroom-word-enter", 8000);
check("…and past half the width, let go, opens the room", slid && path() === "/darkroom", path());
check("…the tabs' own pager held still all the while (still the Post tab)", (await tabIndex()) === 2, String(await tabIndex()));
await appBack(page, 2000);
check("…and once: one step back is Recent, not another room", path() === "/create" && (await pagerAt()) === 0, `${path()} · ${await pagerAt()}`);

// By finger, the same.
await touchDrag(page, { x: W - 20, y: 300 }, { x: 40, y: 300 }, { steps: 30, pause: 20 });
check("A finger's slow slide past half opens the room as well", (await appears("darkroom-word-enter", 8000)) && path() === "/darkroom", path());
await appBack(page, 2000);

// Asked twice at once: MEMORY ROOM tapped twice, quickly. One room.
await byId("post-head-room").first().click();
await byId("post-head-room").first().click({ timeout: 1000 }).catch(() => {});
await appears("darkroom-word-enter", 8000);
await wait(1500);
await appBack(page, 2000);
check("Memory Room tapped twice opens one room: one step back is Recent", path() === "/create" && (await pagerAt()) === 0, `${path()} · ${await pagerAt()}`);

// Sent to the background and back: the slide still opens the room, and the tabs stay held.
await visibility(page, true);
await wait(300);
await visibility(page, false);
await wait(1200);
await mouseDrag(page, { x: W - 20, y: 300 }, { x: 40, y: 300 }, { steps: 30, pause: 25, hold: 200 });
check("Back from the background, the slide still opens the room, the tabs still held", path() === "/darkroom" && (await tabIndex()) === 2, path());
await appBack(page, 2000);

// Left for Search, the tabs' pager swipes again; back on Post, it is held again.
await seen(page.locator('[role="tab"]')).nth(1).click();
await wait(1500);
// By finger: a mouse pressed on one of Search's pictures would pick it up, as the browser drags an image.
await touchDrag(page, { x: W - 30, y: H - 140 }, { x: 30, y: H - 140 });
const fromSearch = await tabIndex();
check("Left for another tab, the tabs' own pager swipes again: Search slid to the left is Post", fromSearch === 2, `tab ${fromSearch}`);
await postTab();
check("…and back on Post it is on Recent", (await pagerAt()) === 0 && (await headerSelected()).recent === "true");

// --- 9. Post, tapped again -----------------------------------------------------------------------------------------------
await tapCell(3);
await scrollRoll(page, 600);
await wait(500);
await postTab(page, 1400);
check(
  "The Post tab tapped again goes back to the top of Recent, with the newest selected",
  (await rollTop()) < 5 && (await selectedCell()) === 0 && (await pagerAt()) === 0,
  `top ${await rollTop()} · ${await selectedCell()}`,
);

// --- 10. the library's every state, and the iPhone's camera tile ---------------------------------------------------------
const state = async (init, ms = 3200) => {
  const p = await phone(W, H, { init });
  await signIn(p);
  await p.goto(B + "/create", { waitUntil: "networkidle" });
  await p.waitForTimeout(ms);
  return p;
};
{
  const p = await state({ __iphone: true });
  const tile = await p.evaluate(() => {
    const t = [...document.querySelectorAll('[data-testid="post-camera"]')].find((e) => e.getBoundingClientRect().width > 0);
    const first = [...document.querySelectorAll('[data-testid="post-cell"], [data-testid="post-camera"]')].find((e) => e.getBoundingClientRect().width > 0);
    if (!t) return null;
    const s = getComputedStyle(t);
    return { first: first === t, bg: s.backgroundColor, border: s.borderTopWidth, line: s.borderTopColor, mark: t.textContent.length > 0, label: t.getAttribute("aria-label") };
  });
  check(
    "On the iPhone the camera is the roll's first tile: the paper, a 1-point line in the strong border, its mark",
    tile && tile.first && tile.bg === "rgb(250, 246, 239)" && tile.border === "1px" && tile.line === "rgb(213, 203, 184)" && tile.mark && tile.label === "Camera",
    JSON.stringify(tile),
  );
  check("…and no clip note, its picker trimming the clip", (await p.locator('[data-testid="post-clip-note"]').count()) === 0);
  await shot("iphone", p);
  await p.context().close();
}
{
  const p = await state({ __acc: "undetermined", __ask: "full" });
  const bar = await p.evaluate(() => [...document.querySelectorAll('[data-testid="post-panel-bar"]')].find((e) => e.getBoundingClientRect().width > 0)?.textContent?.trim());
  const panel = await boxOn(p, "post-panel");
  check("Never asked: the frame explains, and its one button says Continue", /^Continue/.test(bar ?? "") && /Your photographs, right here\./.test(await text(p)), String(bar));
  check("…in the same frame the photograph stands in", panel && Math.abs(panel.x - (W - 336) / 2) < 1 && Math.abs(panel.y - 56) < 1 && Math.abs(panel.height - 420) < 1, JSON.stringify(panel));
  check("…with POST's place kept, and nothing to post", (await p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="post-post"]')).opacity)) === "0");
  await shot("ask", p);
  await seen(p.locator('[data-testid="post-panel-bar"]')).first().click();
  await p.waitForTimeout(2500);
  check("…and one tap asks iOS once, and the roll comes in", (await p.evaluate(() => window.__asked)) === 1 && (await appears("post-hero", 5000, p)));
  await p.context().close();
}
{
  const p = await state({ __acc: "denied" });
  const t = await text(p);
  check(
    "Refused: CHOOSE A PHOTOGRAPH, the way through Settings and OPEN SETTINGS, in the frame",
    /VINTAGE can’t see your photographs\./.test(t) && /Choose a photograph/i.test(t) && (await byId("post-panel-quiet", p).count()) > 0 && /Full Access|Full Access/.test(t),
  );
  const wanted = p.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
  await byId("post-panel-bar", p).first().click();
  const opened = await wanted;
  if (opened) await opened.setFiles([]);
  check("…and CHOOSE A PHOTOGRAPH opens the picker", opened != null);
  await shot("denied", p);
  await p.context().close();
}
{
  const p = await state({ __acc: "limited" });
  const more = await boxOn(p, "post-share-more");
  const first = await p.evaluate(() => [...document.querySelectorAll('[data-testid="post-share-more"], [data-testid="post-cell"]')].find((e) => e.getBoundingClientRect().width > 0)?.getAttribute("data-testid"));
  check("Limited: SHARE MORE stands first in the roll, the photographs after it", more != null && first === "post-share-more" && (await appears("post-hero", 3000, p)), String(first));
  await shot("limited", p);
  await p.context().close();
}
{
  const p = await state({ __lib: "empty" });
  check("An empty library says so in the frame", /Nothing here yet\./.test(await text(p)) && (await boxOn(p, "post-panel"))?.height >= 419);
  await p.context().close();
}
{
  const p = await state({ __lib: "fail" });
  check("A library that would not answer says TRY AGAIN, never that it is empty", /Your photographs didn’t load\./.test(await text(p)) && !/Nothing here yet/.test(await text(p)));
  await p.context().close();
}
{
  const p = await state({ __lib: "slow" }, 2000);
  const panel = await boxOn(p, "post-panel");
  check("Reading: the frame is a well, the same shape", panel && Math.abs(panel.height - 420) < 1 && (await p.evaluate(() => getComputedStyle([...document.querySelectorAll('[data-testid="post-panel"]')][0]).backgroundColor)) === "rgb(243, 237, 226)", JSON.stringify(panel));
  await p.context().close();
}

// --- 11. 320 and 440 points --------------------------------------------------------------------------------------------------
for (const [w, h] of [[320, 568], [440, 956]]) {
  const p = await phone(w, h);
  await signIn(p);
  await p.goto(B + "/create", { waitUntil: "networkidle" });
  await p.waitForTimeout(2200);
  await appears("post-hero", 8000, p);
  await p.waitForTimeout(600);
  const fit = await p.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth }));
  check(`Nothing runs off the side at ${w} points`, fit.scrollWidth <= w, JSON.stringify(fit));
  const post = await boxOn(p, "post-post");
  const frame = await boxOn(p, "post-hero");
  check(`…the frame 27 in from either edge, POST in view without scrolling, on its right edge`, frame && Math.abs(frame.x - 27) < 1 && post && post.bottom <= h - 49 && Math.abs(post.right - (w - 27)) < 1, JSON.stringify({ frame, post }));
  const line = await p.evaluate(() =>
    ["Library", "Video", "Post"].every((word) =>
      [...document.querySelectorAll("body *")].some((d) => {
        const r = d.getBoundingClientRect();
        return d.children.length === 0 && d.textContent?.trim() === word && r.width > 0 && r.right <= window.innerWidth && r.left >= 0;
      }),
    ),
  );
  check(`…with LIBRARY, VIDEO and POST on the one line`, line);
  await shot(String(w), p);
  await p.context().close();
}

// --- 12. the tab at rest, on a clock the walk moves on ------------------------------------------------------------------------
const rest = await phone(W, H, { clock: true });
await signIn(rest);
await postTab(rest, 2600);
await appears("post-hero", 8000, rest);
await tapCell(2, rest);
const restDrawn = await drawnNow(rest);
// Another tab, for longer than the tab waits before letting go of what is out of sight.
await seen(rest.locator('[role="tab"]')).nth(3).click();
await rest.waitForTimeout(600);
await rest.clock.fastForward("00:11");
await rest.waitForTimeout(400);
await postTab(rest, 1200);
const restBack = await drawnNow(rest);
check(
  "Left for another tab and back, the page is as it was, the same photograph selected, on Recent",
  restBack.allDrawn === restDrawn.allDrawn && (await selectedCell(rest)) === 2 && (await pagerAt(rest)) === 0,
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

// --- 13. --------------------------------------------------------------------------------------------------------------------------
check("The browser's bundle was patched for every state it was asked to show", patched >= 8, String(patched));
check("No page errors", errors.length === 0, errors.slice(0, 5).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
