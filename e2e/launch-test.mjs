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
// A Chromium built without H.264 refuses a demo video's play() ("no
// supported source"). That is the browser, not the app; which feed rows
// render — and so whether a video is among them — depends on the time of
// day the demo is seeded at. Forgiven only when the browser really cannot
// play H.264, so a broken video address still fails the test elsewhere.
let noH264 = false;
page.on("pageerror", (e) => {
  if (noH264 && /no supported source/.test(e.message)) return;
  errors.push(e.message);
});
noH264 = await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') === "");
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) {
    errors.push("console: " + m.text());
  }
});
// showAlert falls back to window.confirm on web; Playwright dismisses
// dialogs unless told otherwise, which would silently cancel every
// confirmation the test gives. A prompt (an era's new name) is answered
// with `promptAnswer` while one is set. A menu of several (a post's "…")
// asks for the number of one: `promptChoice` names the one to take, and
// without it the menu is left as it was. Every dialog's words are kept.
let promptAnswer = null;
let promptChoice = null;
const dialogs = [];
page.on("dialog", (d) => {
  dialogs.push(d.message());
  if (d.type() === "prompt" && promptChoice != null) {
    const line = d.message().split("\n").find((l) => l.trim().endsWith(promptChoice));
    return d.accept(line?.trim().match(/^\d+/)?.[0] ?? "");
  }
  return d.type() === "prompt" && promptAnswer != null ? d.accept(promptAnswer) : d.accept();
});

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
check("Landing reads as a closed door", /Members only/.test(await text()));
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
check("Application lands on the waitlist screen", /Application received/i.test(pendingText));
check("Applicant carries no membership number", !/NO\. \d{5}/.test(pendingText));
await shot("03-pending");

// 2. the founder approves
await tap("Sign out", 2600);
check("Signing out from the waitlist reaches the door", /Members only/.test(await text()));
await signInAs("admin@vintage.club");
await tab("profile");
await byLabel("Admin").first().click();
await wait(2300);
await tap("Applications", 2600);
const queue = await text();
check("Application reaches the admin queue", /wren\.alcott/.test(queue));
check("Queue shows who invited an applicant", /invited by/.test(queue));
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

// 3. a member's invitation
await back();
await signOutFromSettings();
await signInAs("elena@vintage.club");
await tab("profile");
await tap("Invitations", 2600);
const nom = await text();
check("Framed as an invitation with an allowance", /invitations? left · \d+ of \d+ taken up|Every invitation you were given/.test(nom));
// The code is the ending of the member's link: shown on its own line under "Copy invitation code".
const codes = (await text()).match(/vintage:\/\/invite\/([a-z0-9-]+)|\/i\/([a-z0-9-]+)/);
const code = codes?.[1] ?? codes?.[2] ?? "";
check("An invitation code is shown", code.length > 0, code || "none");
await shot("07-invitations");

// 4. the invitation is taken up
await back();
await signOutFromSettings();
await tap("I have an invitation", 2500);
check("Invitation screen is framed as an invitation", /By invitation/.test(await text()));
const g = fields();
await g.nth(0).fill(code);
await g.nth(1).fill("Ada Fen");
await g.nth(2).fill("ada.fen");
await g.nth(3).fill("ada@example.com");
await g.nth(4).fill("vintage-demo");
await shot("08-nomination-card");
await tap("Accept the invitation", 4200);
// Assert positively that the feed is showing. The gate screens stay
// mounted underneath, so their text is still in the DOM and its absence
// proves nothing.
const admitted = await text();
check(
  "Redeemed invitation admits straight to the feed",
  /elena\.marchetti|june\.nakamura|sam\.okafor/.test(admitted) && !/Application received/i.test(admitted),
);
await shot("09-admitted");

await tab("profile", 2800);
const newMember = await text();
check("New member is numbered on entry", /NO\. \d{5}/.test(newMember));
check("New member reads as a member", /MEMBER · NO\. \d{5}/.test(newMember));
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
// The last line of a card is when it went up, said in full to a screen reader.
const posted = seen(page.getByLabel(/^Posted (just now|\d+ (minute|hour|day)s? ago|[A-Z][a-z]+ \d{1,2}(, \d{4})?)$/));
const postedLine = (await posted.count()) ? ((await posted.first().textContent()) ?? "") : "";
check("A feed card says when it was posted", /^(Just now|\d+[mhd] ago|[A-Z][a-z]{2} \d{1,2}(, \d{4})?)$/.test(postedLine), postedLine);
// As it is drawn, not only as it is written: 29m ago, never 29M AGO, which reads as months.
const postedShown = (await posted.count()) ? await posted.first().evaluate((el) => el.innerText) : "";
check("The posted line is drawn as it is said, not in capitals", /^(Just now|\d+[mhd] ago|[A-Z][a-z]{2} \d{1,2}(, \d{4})?)$/.test(postedShown), postedShown);
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

// Editorial (Preview): the same feed set out by another card, chosen in
// Settings with the paper it lies on. Home and the gallery draw that card,
// and the whole of the feed is the one paper: the screen, the bars and
// every print. Once Original is chosen again no editorial card is left
// anywhere in the page, Home is on the app's own paper whatever paper was
// chosen, and the original's own line (the caption after the member's
// name) is back.
const choose = async (...labels) => {
  await tab("profile");
  await byLabel("Settings").first().click();
  await wait(2200);
  for (const label of labels) {
    await seen(page.getByRole("radio", { name: label, exact: true })).first().click();
    await wait(900);
  }
  // The paper is offered only while the feed is Editorial.
  const papers = await seen(page.getByRole("radiogroup", { name: "Paper" })).count();
  await tab("home");
  return papers;
};
/** The colour seen at the middle of something: the first background there, whatever draws it (a bar's may be a layer of its own). */
const paperOf = (locator) =>
  locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    for (const n of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)) {
      const c = getComputedStyle(n).backgroundColor;
      if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
    }
    return "";
  });
/** The colour of the screen a card lies on: the first background among the card's containers. */
const screenUnder = (card) =>
  card.first().evaluate((el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
    }
    return "";
  });
const tabBar = () => seen(page.locator('[role="tablist"]'));
/** Every print on screen, the screen behind them and the bars around it: the colours they come to. */
const papersOf = async (cards, ...bars) => {
  const prints = await cards.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  const around = [await screenUnder(cards)];
  for (const bar of bars) around.push(await paperOf(bar));
  return [...new Set([...prints, ...around])];
};
const OFF_WHITE = "rgb(250, 246, 239)";
const WHITE = "rgb(255, 255, 255)";
const wordmark = () => byText("VINTAGE");

check("The paper is offered once Editorial is chosen", (await choose("Editorial (Preview)")) > 0);
const editorial = seen(page.locator('[data-testid="editorial-post-card"]'));
check("Editorial (Preview) sets Home out with the editorial card", (await editorial.count()) > 0);
// Each post a print: the place and the date in full on its label, and no @name, number or count.
const prints = await editorial.evaluateAll((els) => els.map((el) => el.textContent ?? ""));
const print = prints[0] ?? "";
check(
  "The editorial card is labelled like a print, without the @name",
  /[A-Z]+ \d{1,2}, \d{4}/.test(print) && prints.every((p) => !/@[a-z0-9._]+/.test(p) && !/MEMBER|NO\. \d{5}/.test(p)),
  print.slice(0, 120),
);
check("The editorial card has no like or comment counts", prints.every((p) => !/\d+ (likes?|comments?)\b/i.test(p)));
// Above the picture, as on the original card: the member's picture and name, and the "…" at the end of their line.
const head = await editorial.first().evaluate((el) => {
  const member = el.firstElementChild?.querySelector('[role="button"]');
  const more = el.firstElementChild?.querySelector('[aria-label="Post options"]');
  const heart = el.querySelector('[aria-label="Like"], [aria-label="Unlike"]');
  const box = (n) => n?.getBoundingClientRect() ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const m = box(member);
  const o = box(more);
  return {
    name: member?.getAttribute("aria-label") ?? "",
    picture: Boolean(member?.querySelector("img, [data-expoimage]")),
    above: m.bottom > 0 && m.bottom <= box(heart).top && o.bottom <= box(heart).top,
    level: Math.abs((m.top + m.bottom) / 2 - (o.top + o.bottom) / 2) < 2 && o.left > m.left,
  };
});
check(
  "The member’s picture and name sit above the picture, with the “…” at the end of their line",
  /^[a-z0-9._]+$/.test(head.name) && head.picture && head.above && head.level,
  JSON.stringify(head),
);
// Around the print, everything starts where Instagram's does: the member,
// the heart, the caption and when it went up from one edge, the hairline
// between the same edges, the buttons just under it, and the next post about
// as close as Instagram's.
const lines = await editorial.evaluateAll((els) => {
  const inside = (n) => {
    const r = n.getBoundingClientRect();
    const st = getComputedStyle(n);
    return { left: r.left + parseFloat(st.paddingLeft), right: r.right - parseFloat(st.paddingRight), top: r.top, bottom: r.bottom - parseFloat(st.paddingBottom) };
  };
  return els.slice(0, 2).map((el) => {
    const card = el.getBoundingClientRect();
    const member = el.firstElementChild?.querySelector('[role="button"]');
    const heart = el.querySelector('[aria-label="Like"], [aria-label="Unlike"]');
    const rule = [...el.querySelectorAll("div")].find((d) => {
      const r = d.getBoundingClientRect();
      return r.height > 0 && r.height < 2 && r.width > 200;
    });
    const caption = [...el.querySelectorAll("div")].find(
      (d) => d.firstElementChild?.tagName === "SPAN" && d.textContent?.startsWith(`${d.firstElementChild.textContent} `),
    );
    const h = heart?.getBoundingClientRect();
    const r = rule?.getBoundingClientRect();
    return {
      width: card.width,
      member: member ? member.getBoundingClientRect().left - card.left : null,
      heart: h ? (h.left + h.right) / 2 - card.left : null,
      underRule: h && r ? (h.top + h.bottom) / 2 - r.bottom : null,
      rule: r ? [r.left - card.left, card.right - r.right] : null,
      caption: caption ? inside(caption).left - card.left : null,
      posted: el.lastElementChild ? inside(el.lastElementChild).left - card.left : null,
      foot: el.lastElementChild ? inside(el.lastElementChild).bottom : null,
      head: member ? member.getBoundingClientRect().top + 5 : null,
    };
  });
});
const near = (a, b, by = 1.5) => a != null && Math.abs(a - b) <= by;
check(
  "The member, the heart, the caption and when it went up start at Instagram's edge, under a hairline between the same edges",
  lines.length > 0 &&
    lines.every(
      (l) =>
        near(l.member, 12) &&
        near(l.heart, 12 + 21 / 2, 2) &&
        (l.caption == null || near(l.caption, 12)) &&
        near(l.posted, 12) &&
        l.rule != null &&
        near(l.rule[0], 12) &&
        near(l.rule[1], 12),
    ),
  JSON.stringify(lines[0]),
);
check(
  "The buttons sit just under the hairline",
  lines.length > 0 && lines.every((l) => l.underRule != null && l.underRule >= 16 && l.underRule <= 25),
  lines.map((l) => l.underRule?.toFixed(1)).join(", "),
);
const gapBetween = lines.length > 1 ? lines[1].head - lines[0].foot : null;
check("One post follows the next about as closely as on Instagram", gapBetween != null && gapBetween >= 18 && gapBetween <= 30, String(gapBetween));
// The caption after the member's name, in bold, as a comment is written.
const captioned = await editorial.first().evaluate(
  (el, name) =>
    [...el.querySelectorAll("div, span")].some(
      (n) =>
        n.textContent?.startsWith(`${name} `) &&
        n.firstElementChild?.textContent === name &&
        Number(getComputedStyle(n.firstElementChild).fontWeight) >= 600,
    ),
  head.name,
);
check("The caption follows its member’s name, as a comment does", captioned);
// Last on each print, when it went up, in the label's capitals.
const foot = await editorial.evaluateAll((els) =>
  els.map((el) => [el.lastElementChild?.getAttribute("aria-label") ?? "", el.lastElementChild?.innerText ?? ""]),
);
check(
  "Every print ends with when it went up",
  foot.length > 0 &&
    foot.every(
      ([label, line]) =>
        /^Posted (just now|\d+ (minute|hour|day)s? ago|[A-Z][a-z]+ \d{1,2}(, \d{4})?)$/.test(label) &&
        /^(JUST NOW|\d+[MHD] AGO|[A-Z]{3} \d{1,2}(, \d{4})?)$/.test(line),
    ),
  foot[0]?.join(" / "),
);
const offWhite = await papersOf(editorial, wordmark(), tabBar());
const strips = await editorial.evaluateAll((els) => els.filter((el) => getComputedStyle(el).borderBottomWidth !== "0px").length);
check(
  "Off-white: the prints, the screen and both bars are one paper, with nothing between the prints",
  offWhite.length === 1 && offWhite[0] === OFF_WHITE && strips === 0,
  offWhite.join(" | "),
);
await shot("12b-editorial");
let editorialLike = "no card to like";
// The member has liked most of the first few already; the first one not yet liked will do.
for (let i = 0; i < (await editorial.count()); i++) {
  const card = editorial.nth(i);
  if (!(await card.getByLabel("Like", { exact: true }).count())) continue;
  await card.getByLabel("Like", { exact: true }).click();
  await wait(1500);
  editorialLike = (await card.getByLabel("Unlike", { exact: true }).count()) > 0 ? "" : "the heart did not fill";
  break;
}
check("Like still works on the editorial card", editorialLike === "", editorialLike);

await choose("White");
const white = await papersOf(editorial, wordmark(), tabBar());
check("White: the prints, the screen and both bars are all white", white.length === 1 && white[0] === WHITE, white.join(" | "));
await shot("12c-editorial-white");

// A profile's photographs in feed view: the gallery a grid square opens, set out the same way, on the same paper.
const author = editorial.nth(1).locator('[role="button"]').first();
const member = (await author.getAttribute("aria-label")) ?? "";
await author.click();
await wait(2600);
const squares = await seen(page.locator("img")).evaluateAll((els) =>
  els
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 100 && Math.abs(r.width - r.height) < 1)
    .map((r) => [r.x + r.width / 2, r.y + r.height / 2]),
);
if (squares.length > 1) await page.mouse.click(squares[1][0], squares[1][1]);
await wait(3200);
const galleryCards = seen(page.locator('[data-testid="editorial-post-card"]'));
const shownInGallery = await galleryCards.count();
const galleryPaper = shownInGallery ? await papersOf(galleryCards, seen(page.getByRole("heading", { name: member }))) : [];
check(
  "A profile’s gallery is set out in prints too, on the same paper under the same bar",
  /\/gallery\?/.test(page.url()) && shownInGallery > 0 && galleryPaper.length === 1 && galleryPaper[0] === WHITE,
  `${member}: ${galleryPaper.join(" | ")}`,
);
await shot("12d-editorial-gallery");

check("The paper is not offered once Original is chosen again", (await choose("Original")) === 0);
check(
  "Original comes back as it was",
  (await page.locator('[data-testid="editorial-post-card"]').count()) === 0 &&
    (await byText("elena.marchetti The 19 tram, before anyone was awake.").count()) > 0,
);
// White is still the paper chosen, but the paper is the editorial feed's
// alone. An original card ends with its posted time, so the line's parent
// is the card.
const originalCard = seen(page.getByLabel(/^Posted /)).first().locator("xpath=..");
const original = [await screenUnder(originalCard), await paperOf(wordmark()), await paperOf(tabBar())];
check("Original lies on the app’s own paper, whatever paper was chosen", original.every((c) => c === OFF_WHITE), original.join(" | "));

await go("/user/tomas.lindqvist", 2800);
const tomas = await text();
check("Profile shows MEMBER and number", /MEMBER · NO\. \d{5}/.test(tomas));
await shot("13-profile-founding");
const follow = () => seen(page.getByText(/^(Follow|Following|Requested)$/)).first();
const before = await follow().textContent();
await follow().click();
await wait(2300);
check("Follow changes state", (await follow().textContent()) !== before, `${before} → …`);

// Eras, between Timeline and Map: the demo's three Stockholm photographs
// of Tomas's were taken within ten days, so they always make an era.
await go("/user/tomas.lindqvist", 2800);
await tap("Eras", 2000);
const eras = await text();
check("Eras gathers a member's photographs by place and year", /Stockholm \d{4}/.test(eras));
check("An era says how many photographs it holds", /\d+ photographs/i.test(eras));
await shot("13b-eras");
await seen(page.getByLabel(/^(Photograph|Film), /)).first().click();
await wait(2600);
// All of Tomas's photographs are in the era, so the cards are the same
// either way: what tells is the gallery's title, which is the era's only
// once the gallery has found the era again. The eras behind it still hold
// those words, out of sight, so only a heading in view counts.
const eraTitle = await seen(page.getByRole("heading", { name: /^Stockholm \d{4}$/ })).count();
check(
  "An era's print opens the gallery, held to that era",
  /\/gallery\?.*era=Stockholm/.test(page.url()) &&
    eraTitle > 0 &&
    /Last ferry|a mirror today|opened for the season/.test(await text()),
  page.url(),
);
await shot("13c-era-gallery");

// The gallery opens on the photograph tapped, with the ones before it
// above. Elena's third photograph, opened as her grid opens it, is the
// first card in view, its top at the top of the list; scrolling up finds
// the one before it. The card at the top is read from the list in front.
const cardAtTop = () =>
  page.evaluate(() => {
    let list = document.elementFromPoint(195, 500);
    while (list && !(/(auto|scroll)/.test(getComputedStyle(list).overflowY) && list.scrollHeight > list.clientHeight)) {
      list = list.parentElement;
    }
    if (!list) return null;
    const top = list.getBoundingClientRect().top;
    for (const cell of list.firstElementChild?.children ?? []) {
      const r = cell.getBoundingClientRect();
      if (r.height > 0 && r.bottom > top + 1) {
        return { text: cell.textContent ?? "", delta: Math.round(r.top - top), opacity: getComputedStyle(list).opacity };
      }
    }
    return null;
  });
await go("/gallery?" + new URLSearchParams({ authorId: "demo-user-elena", postId: "demo-post-03", sort: "posted" }).toString(), 3200);
const landedOn = await cardAtTop();
check(
  "A photograph tapped in a grid opens the gallery on it",
  /Fog on the Naviglio/.test(landedOn?.text ?? "") && Math.abs(landedOn.delta) <= 1 && landedOn.opacity === "1",
  JSON.stringify(landedOn && { delta: landedOn.delta, card: landedOn.text.slice(0, 48) }),
);
await shot("13c-gallery-landed");
await page.mouse.move(195, 500);
await page.mouse.wheel(0, -350);
await wait(900);
const cardBefore = await cardAtTop();
check("Scrolling up from it finds the photograph before", /Nonna.s courtyard/.test(cardBefore?.text ?? ""), cardBefore?.text.slice(0, 48));
// A post's own page ends what it says about the post with when it went up, as its card does.
await go("/post/demo-post-03", 2600);
const pagePosted = seen(page.getByLabel(/^Posted (just now|\d+ (minute|hour|day)s? ago|[A-Z][a-z]+ \d{1,2}(, \d{4})?)$/));
check("A post's own page says when it was posted", (await pagePosted.count()) === 1, String(await pagePosted.count()));

// Eras the member arranges, on their own page only: EDIT, rename an era,
// move a photograph into it, DONE. Two of the demo's Milan photographs of
// Elena's were taken in January 2025, so she has two Milan eras. All of
// it in one visit, by tapping: the demo keeps the arrangement in the page.
await go("/profile", 2800);
await tap("Eras", 2000);
await byLabel("Edit eras").first().click();
await wait(900);
check("Your own Eras opens for arranging", /Arranging/.test(await text()) && (await byLabel("Rename Milan 2025").count()) > 0);
promptAnswer = "The foggy winter";
await byLabel("Rename Milan 2025").first().click();
await wait(1200);
promptAnswer = null;
const heading = (name) => seen(page.getByRole("heading", { name })).count();
check("An era takes the name its member gives it", (await heading(/^The foggy winter, 2 photographs$/)) > 0);
await seen(page.getByLabel(/^Photograph, .*The 19 tram/)).first().click();
await wait(1200);
const sheet = seen(page.getByTestId("era-move-sheet"));
check("A print, tapped while arranging, asks which era it belongs in", (await sheet.count()) > 0 && /Move to/i.test(await sheet.first().textContent()));
await shot("13d-era-move");
await seen(page.getByRole("button", { name: /^The foggy winter, 2 photographs/ })).first().click();
await wait(900);
check(
  "The photograph moves into the era chosen, and the page says so",
  (await heading(/^The foggy winter, 3 photographs$/)) > 0 && /Moved to The foggy winter/i.test(await text()),
);
await byLabel("Done arranging eras").first().click();
await wait(900);
check(
  "DONE leaves the eras as arranged, and EDIT to open them again",
  (await byLabel("Edit eras").count()) > 0 && (await heading(/^The foggy winter, 3 photographs$/)) > 0,
);
await shot("13e-eras-arranged");

// ADD, NEW ERA, "New era…", taking a photograph out and deleting an era
// of her own, all in the same visit. The foggy winter holds the tram and
// both of January's; Milan 2026 is left with the courtyard.
await byLabel("Edit eras").first().click();
await wait(900);
check(
  "Arranging offers ADD on every era, and NEW ERA in the bar",
  (await byLabel("Add to The foggy winter").count()) > 0 &&
    (await byLabel("Add to Milan 2026").count()) > 0 &&
    (await byLabel("New era").count()) > 0,
);
await shot("13f-eras-add-new");
const gather = () => seen(page.getByTestId("era-gather-sheet")).first();
const confirmOff = async () => (await gather().getByTestId("era-gather-confirm").getAttribute("aria-disabled")) === "true";
const pick = (caption) => seen(gather().getByRole("checkbox", { name: caption })).first();
await byLabel("Add to Milan 2026").first().click();
await wait(1200);
check(
  "ADD lists the photographs in other eras by era, and adds nothing until one is chosen",
  /Add to Milan 2026/i.test(await gather().textContent()) &&
    (await seen(gather().getByRole("heading", { name: "The foggy winter" })).count()) > 0 &&
    (await confirmOff()),
);
await pick(/Fog on the Naviglio/).click();
await wait(500);
check("Choosing a photograph offers to add it, by count", !(await confirmOff()) && /Add 1/.test(await gather().textContent()));
await shot("13g-era-add-sheet");
await gather().getByTestId("era-gather-confirm").click();
await wait(900);
check(
  "ADD brings a photograph over from another era, and the page says so",
  (await heading(/^Milan 2026, 2 photographs$/)) > 0 &&
    (await heading(/^The foggy winter, 2 photographs$/)) > 0 &&
    /Added 1 to Milan 2026/i.test(await text()),
);

await byLabel("New era").first().click();
await wait(1200);
check("NEW ERA asks for a name and photographs, and makes nothing before both", /New era/i.test(await gather().textContent()) && (await confirmOff()));
await seen(gather().getByTestId("era-name")).first().fill("Saturdays");
await wait(300);
const namedOnly = await confirmOff();
await pick(/Saturday market/).click();
await wait(500);
check("A name and a photograph make it possible", namedOnly && !(await confirmOff()));
await shot("13h-era-new-sheet");
await gather().getByTestId("era-gather-confirm").click();
await wait(900);
check(
  "A new era takes its place on the page, with its photograph",
  (await heading(/^Saturdays, 1 photograph$/)) > 0 && (await heading(/^The foggy winter, 1 photograph$/)) > 0 && /Made Saturdays/i.test(await text()),
);

const moveSheet = () => seen(page.getByTestId("era-move-sheet")).first();
await seen(page.getByLabel(/^Photograph, .*The 19 tram/)).first().click();
await wait(1200);
check(
  "Move to offers a new era, and the way out of the era a move put it in",
  (await moveSheet().getByRole("button", { name: "New era" }).count()) > 0 &&
    (await moveSheet().getByRole("button", { name: /^Take out of The foggy winter\. Back to Milan 2026\.$/ }).count()) > 0,
);
await shot("13i-era-move-new");
await moveSheet().getByRole("button", { name: "New era" }).click();
await wait(1200);
check("New era… turns the sheet to a new era with the photograph already chosen", (await pick(/The 19 tram/).getAttribute("aria-checked")) === "true");
await seen(gather().getByTestId("era-name")).first().fill("Early trams");
await gather().getByTestId("era-gather-confirm").click();
await wait(900);
check("The new era is made with it", (await heading(/^Early trams, 1 photograph$/)) > 0 && /Made Early trams/i.test(await text()));

await seen(page.getByLabel(/^Photograph, .*The 19 tram/)).first().click();
await wait(1200);
await moveSheet().getByRole("button", { name: /^Take out of Early trams/ }).click();
await wait(900);
check(
  "Taken out, a photograph goes back where it came from, and an era of the member's own goes with its last",
  (await heading(/^Milan 2026, 3 photographs$/)) > 0 && (await heading(/^Early trams/)) === 0 && /Back in Milan 2026/i.test(await text()),
);

promptAnswer = "";
await byLabel("Rename Saturdays").first().click();
await wait(1200);
promptAnswer = null;
check(
  "An era of the member's own is deleted from its name, asked once more, and its photograph goes back",
  dialogs.some((m) => /Leave it empty to delete it/.test(m)) &&
    dialogs.some((m) => /^Delete “Saturdays”\?/.test(m)) &&
    (await heading(/^Saturdays/)) === 0 &&
    (await heading(/^The foggy winter, 1 photograph$/)) > 0,
);
await byLabel("Done arranging eras").first().click();
await wait(900);

// From the feed: the "…" on her own photograph adds it to an era; on
// another member's, it never does. Tapped, so the arrangement stays.
await tab("home");
const cardOf = (caption) =>
  seen(page.locator("div").filter({ hasText: caption }).filter({ has: page.getByLabel("Post options", { exact: true }) })).last();
await cardOf("Last ferry of the evening").getByLabel("Post options", { exact: true }).first().click();
await wait(900);
const theirs = dialogs.at(-1) ?? "";
check("Another member's post offers no era", /Report post/.test(theirs) && !/Add to an era/.test(theirs));
await cardOf("The 19 tram").scrollIntoViewIfNeeded();
await shot("13j-feed-own-post");
promptChoice = "Add to an era…";
await cardOf("The 19 tram").getByLabel("Post options", { exact: true }).first().click();
await wait(2200);
promptChoice = null;
check(
  "Your own post's options add it to an era, in the sheet the Eras page uses",
  /Add to an era…/.test(dialogs.at(-1) ?? "") &&
    /\/era-move\?postId=/.test(page.url()) &&
    /Move to/i.test(await moveSheet().textContent()) &&
    (await moveSheet().getByRole("button", { name: "New era" }).count()) > 0,
);
await shot("13j-feed-add-to-era-sheet");
await moveSheet().getByRole("button", { name: /^The foggy winter, 1 photograph/ }).click();
await wait(1600);
// The web lays the tabs out afresh under a screen pushed over them, as it does after Edit caption.
await tab("profile");
await tap("Eras", 2000);
check(
  "Your Eras show the change made from the feed",
  !/\/era-move/.test(page.url()) && (await heading(/^The foggy winter, 2 photographs$/)) > 0 && (await heading(/^Milan 2026, 2 photographs$/)) > 0,
);
await shot("13k-eras-after-feed");

// Dragging, while arranging: a print held a moment lifts, and goes to the
// era it is let go over; over its own, or off the page, it goes back. The
// page scrolls itself, so each print is first brought to a set place.
await byLabel("Edit eras").first().click();
await wait(900);
const scrollerTop = (locator) =>
  locator.evaluate((el) => {
    let s = el.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll|hidden)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    return s ? { top: s.scrollTop, bottom: s.getBoundingClientRect().bottom, free: getComputedStyle(s).overflowY !== "hidden" } : null;
  });
const bringTo = async (locator, y) => {
  await locator.evaluate((el, at) => {
    let s = el.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    if (s) s.scrollTop += el.getBoundingClientRect().top - at;
  }, y);
  await wait(500);
};
const hold = async (locator) => {
  const b = await locator.boundingBox();
  const at = { x: b.x + b.width / 2, y: b.y + Math.min(b.height, 80) / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await wait(300);
  return at;
};
const printOf = (caption) => seen(page.getByLabel(new RegExp(`^Photograph, .*${caption}`))).first();
const lifted = () => seen(page.getByTestId("era-drag-print")).count();
const framed = () => seen(page.getByTestId("era-drop-target")).count();
// Put back, the copy flies home and goes; a move takes it at once.
const putBack = () =>
  page.waitForFunction(() => !document.querySelector('[data-testid="era-drag-print"]'), null, { timeout: 4000 }).then(
    () => true,
    () => false,
  );
// The note at the foot of the screen; the words stay on in the web's live region, which is not it.
const noted = (words) =>
  page.evaluate((w) => [...document.querySelectorAll('[dir="auto"]')].some((t) => t.textContent === w && !t.closest("[aria-live]")), words);
// Milan 2026 holds the courtyard and the Naviglio's fog; The foggy winter
// the market and the tram. The two that lie nearest each other, one from
// each, are brought into view together, the upper a little under the bar.
let pair = null;
for (const from of ["Nonna’s courtyard", "Fog on the Naviglio"]) {
  for (const to of ["Saturday market", "The 19 tram"]) {
    const a = await printOf(from).boundingBox();
    const b = await printOf(to).boundingBox();
    if (!pair || Math.abs(a.y - b.y) < pair.apart) pair = { from, to, apart: Math.abs(a.y - b.y), upper: a.y < b.y ? from : to };
  }
}
await bringTo(printOf(pair.upper), 260);
const fromAt = await hold(printOf(pair.from));
const lifts = await lifted();
const toBox = await printOf(pair.to).boundingBox();
await page.mouse.move(fromAt.x + 8, fromAt.y + 8, { steps: 3 });
await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + Math.min(toBox.height, 80) / 2, { steps: 12 });
await wait(400);
check(
  "A print held while arranging lifts, and the era under it is framed and named",
  lifts > 0 && (await framed()) === 1 && /^Move to The foggy winter$/.test(await seen(page.getByTestId("era-drag-slip")).first().textContent()),
);
await shot("13l-eras-drag");
await page.mouse.up();
await wait(900);
check(
  "Let go over another era, the photograph moves there, and the page says so",
  (await heading(/^The foggy winter, 3 photographs$/)) > 0 &&
    (await heading(/^Milan 2026, 1 photograph$/)) > 0 &&
    (await noted("Moved to The foggy winter")) &&
    (await lifted()) === 0,
);
await wait(2600);

// What is left in Milan 2026, nudged within it.
const stays = pair.from === "Fog on the Naviglio" ? "Nonna’s courtyard" : "Fog on the Naviglio";
await bringTo(printOf(stays), 300);
const homeAt = await hold(printOf(stays));
await page.mouse.move(homeAt.x + 30, homeAt.y + 40, { steps: 8 });
await wait(300);
const ownLifted = await lifted();
const ownFramed = (await framed()) + (await seen(page.getByTestId("era-drag-slip")).count());
await page.mouse.up();
check(
  "Let go over its own era, it goes back and nothing changes",
  ownLifted > 0 &&
    ownFramed === 0 &&
    (await putBack()) &&
    (await heading(/^The foggy winter, 3 photographs$/)) > 0 &&
    (await heading(/^Milan 2026, 1 photograph$/)) > 0 &&
    !(await noted("Moved to The foggy winter")) &&
    !(await noted("Moved to Milan 2026")),
);

const firstPrint = seen(page.getByLabel(/^Photograph, /)).first();
await bringTo(firstPrint, 300);
const runFrom = await scrollerTop(firstPrint);
const runAt = await hold(firstPrint);
await page.mouse.move(runAt.x, runFrom.bottom - 60, { steps: 8 });
await page.mouse.move(runAt.x, runFrom.bottom - 6, { steps: 4 });
await wait(700);
const running = await scrollerTop(firstPrint);
await page.mouse.move(runAt.x, runFrom.bottom + 20, { steps: 3 });
await page.mouse.up();
const home = await putBack();
const ranTo = await scrollerTop(firstPrint);
check(
  "Held near the foot of the page, it scrolls on its own, and let go off it, nothing moves",
  running.top > runFrom.top + 100 &&
    !running.free &&
    home &&
    ranTo.free &&
    (await heading(/^The foggy winter, 3 photographs$/)) > 0 &&
    (await heading(/^Milan 2026, 1 photograph$/)) > 0,
  `${runFrom.top} → ${running.top}`,
);
await byLabel("Done arranging eras").first().click();
await wait(900);

// A member's own name for their era, on their page, where it cannot be changed.
await go("/user/niko.papadakis", 2800);
await tap("Eras", 2000);
check(
  "A member's Eras show the names they gave them, with nothing to edit",
  (await heading(/^Islands, off-season, \d+ photographs$/)) > 0 && (await byLabel("Edit eras").count()) === 0,
);

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
// The place is chosen in a sheet: open it from the "Where" row, type, take the words.
await byLabel("Choose a place").first().click();
await wait(1200);
const where = seen(page.getByPlaceholder(/a town, a street|a restaurant, a hotel/i)).first();
await where.fill("Leith");
await where.press("Enter");
await wait(1200);
await shot("17-compose");
await tap("Share to VINTAGE", 4600);
const afterPost = await text();
check("Post publishes into the feed", /Leith/.test(afterPost));
check("Stamp reads the capture date, not today", /6 14/.test(afterPost));
// Taken in June, posted now: the card's last line is the posting time.
check("A new post says it went up just now", (await byLabel("Posted just now").count()) > 0);
await shot("18-posted");

console.log("\nJS errors:", errors.length ? errors.slice(0, 10) : "none");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log("FAILED: " + failed.map((r) => r.name).join(" | "));
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
