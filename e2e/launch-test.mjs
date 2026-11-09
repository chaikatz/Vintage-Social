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
// Answers for the next confirmations, in order: true is OK, false is
// Cancel. Empty, every confirmation is accepted as before.
const answers = [];
const dialogs = [];
page.on("dialog", (d) => {
  dialogs.push(d.message());
  if (d.type() === "confirm" && answers.length) return answers.shift() ? d.accept() : d.dismiss();
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

// Review blocker A (Guideline 5.1.1(v)): an applicant can delete the
// account from the waiting screen, where Settings is out of reach. The two
// questions are Settings' own; Keep my account at the second keeps it.
check("The waiting screen offers Delete my account", (await byText("Delete my account").count()) > 0);
{
  const before = dialogs.length;
  answers.push(true, false);
  await tap("Delete my account", 1800);
  const asked = dialogs.slice(before).map((m) => m.split("\n")[0]);
  check(
    "Delete my account asks Settings' two questions, and Keep my account keeps the account",
    asked.join(" → ") === "Delete your account? → Are you sure?" && /Application received/i.test(await text()) && /\/pending/.test(page.url()),
    asked.join(" → ") || "no dialog",
  );
  check(
    "…and its first question says what stays, as the Privacy Policy does: the reports filed",
    /removed for good\. The reports you filed are kept without your account attached\. This cannot be undone\./.test(dialogs[before] ?? ""),
    (dialogs[before] ?? "no dialog").split("\n").slice(1).join(" "),
  );
  check(
    "…and its second says the account goes now, never that everything does",
    /This is the last step\. Your account is deleted now\./.test(dialogs[before + 1] ?? "") && !/everything/i.test(dialogs[before + 1] ?? ""),
    (dialogs[before + 1] ?? "no dialog").split("\n").slice(1).join(" "),
  );
}

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
// Who the last member looked for in Search is not left for the next one
// (src/utils/searchHistory.ts keeps it in localStorage on the web).
await page.evaluate(() =>
  localStorage.setItem(
    "vintage.recent-searches",
    JSON.stringify([{ id: "someone", username: "looked.for", full_name: null, avatar_url: null }]),
  ),
);
await signOutFromSettings();
check(
  "Sign out forgets the member's recent searches",
  (await page.evaluate(() => localStorage.getItem("vintage.recent-searches"))) === "[]",
);
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
// This browser has no share sheet, as a phone may fail to open one: the
// tap says so and points at Copy, where it used to end in silence.
{
  const before = dialogs.length;
  await tap("Send invitation", 1400);
  check(
    "Send invitation that cannot open sharing says so",
    dialogs.length > before && /Couldn’t open sharing/.test(dialogs.at(-1) ?? ""),
    dialogs.length > before ? dialogs.at(-1) : "no dialog",
  );
}

// 4. the invitation is taken up
await back();
await signOutFromSettings();
await tap("I have an invitation", 2500);
check("Invitation screen is framed as an invitation", /By invitation/.test(await text()));
// Review blocker B (Guideline 1.2): what is agreed to, before the account is made.
check(
  "The invitation says the Terms and the Privacy Policy are agreed to",
  /By accepting you agree to the Terms of Use and Privacy Policy\./.test(await text()) &&
    (await seen(page.getByRole("link", { name: "Terms of Use", exact: true })).count()) > 0 &&
    (await seen(page.getByRole("link", { name: "Privacy Policy", exact: true })).count()) > 0,
);
// The review notes send Apple here: opened empty, the card welcomes, and
// does not open on "That invitation isn’t one we know".
check(
  "Opened empty, the invitation welcomes rather than refuses",
  (await seen(page.getByText(/A member has put your name forward/)).count()) > 0 &&
    (await seen(page.getByText(/isn’t one we know/)).count()) === 0,
);
const g = fields();
await g.nth(0).fill(code);
await wait(1400);
check(
  "Once the code is in, the invitation says who sent it",
  (await seen(page.getByText(/Elena Marchetti invited you to VINTAGE/)).count()) > 0,
);
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

check("The paper is offered once Editorial is chosen", (await choose("Editorial")) > 0);
const editorial = seen(page.locator('[data-testid="editorial-post-card"]'));
check("Editorial sets Home out with the editorial card", (await editorial.count()) > 0);
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
// between the same edges, and the next post about as close as Instagram's.
// The photograph is as far under the member's picture as the hairline is
// under the photograph, and the buttons start where the print's label does.
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
    const photo = [...el.querySelectorAll("img")].map((i) => i.getBoundingClientRect()).find((b) => b.width > 200);
    const avatarBottom = member ? member.getBoundingClientRect().top + 5 + 34 : null;
    return {
      width: card.width,
      member: member ? member.getBoundingClientRect().left - card.left : null,
      heart: h ? (h.left + h.right) / 2 - card.left : null,
      underRule: h && r ? (h.top + h.bottom) / 2 - r.bottom : null,
      overPhoto: photo && avatarBottom != null ? photo.top - avatarBottom : null,
      underPhoto: photo && r ? r.top - photo.bottom : null,
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
  "The photograph is as far under the member's picture as the hairline is under it",
  lines.length > 0 && lines.every((l) => l.overPhoto != null && l.underPhoto != null && l.overPhoto > 15 && near(l.overPhoto, l.underPhoto)),
  lines.map((l) => `${l.overPhoto?.toFixed(1)} / ${l.underPhoto?.toFixed(1)}`).join(", "),
);
check(
  "The buttons start a little under the hairline, where the print's label does",
  lines.length > 0 && lines.every((l) => l.underRule != null && l.underRule >= 21 && l.underRule <= 26),
  lines.map((l) => l.underRule?.toFixed(1)).join(", "),
);
const gapBetween = lines.length > 1 ? lines[1].head - lines[0].foot : null;
check("One post follows the next about as closely as on Instagram", gapBetween != null && gapBetween >= 18 && gapBetween <= 30, String(gapBetween));
// The caption after the member's name, the name a span of its own, as a comment is written.
const captioned = await editorial.first().evaluate(
  (el, name) =>
    [...el.querySelectorAll("div, span")].some(
      (n) => n.textContent?.startsWith(`${name} `) && n.firstElementChild?.tagName === "SPAN" && n.firstElementChild.textContent === name,
    ),
  head.name,
);
check("The caption follows its member’s name, as a comment does", captioned);
// Last on each print, when it went up, in the label's face, as it is said.
const lastLines = await editorial.evaluateAll((els) =>
  els.map((el) => [el.lastElementChild?.getAttribute("aria-label") ?? "", el.lastElementChild?.innerText ?? ""]),
);
check(
  "Every print ends with when it went up",
  lastLines.length > 0 &&
    lastLines.every(
      ([label, line]) =>
        /^Posted (just now|\d+ (minute|hour|day)s? ago|[A-Z][a-z]+ \d{1,2}(, \d{4})?)$/.test(label) &&
        /^(Just now|\d+[mhd] ago|[A-Z][a-z]{2} \d{1,2}(, \d{4})?)$/.test(line),
    ),
  lastLines[0]?.join(" / "),
);
// Usernames, all around the app, while Editorial is chosen: in the app's
// own face, size, colour and spacing, exactly as under Original, but not
// bold. A state that means something still wins: an unread thread's name
// is bold. What was written with them, and display names, are as they
// were. Each is read as "face|weight|colour|tracking|size".
const MONO = /monospace/;
/** The words' ink (colors.ink, the light paper's): every name read here is in it, under either layout. */
const INK = "rgb(43, 38, 32)";
const drawnAs = (f) => {
  const [face, weight, color, spacing, size] = (f ?? "").split("|");
  return { face, weight, color, spacing, size };
};
/** In the app's own face, not the typewriter's, in the words' ink, untracked, at this weight. */
const setAs = (f, weight) => {
  const s = drawnAs(f);
  return !MONO.test(s.face) && s.weight === weight && s.color === INK && s.spacing === "normal";
};
const allSetAs = (faces, weight) => faces.length > 0 && faces.every((f) => setAs(f, weight));
/** All but the weight: the face, the colour, the tracking and the size. */
const allButWeight = (f) => {
  const { face, color, spacing, size } = drawnAs(f);
  return [face, color, spacing, size].join("|");
};
/** The same faces, colours, tracking and sizes in both readings, whatever their weights. */
const sameButWeight = (a, b) =>
  a.length > 0 && b.length > 0 && JSON.stringify([...new Set(a.map(allButWeight))].sort()) === JSON.stringify([...new Set(b.map(allButWeight))].sort());
/** Every username drawn on screen, as it is drawn: words that are a username alone (a space after it aside), in an element of their own. */
const namesOnScreen = () =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("div, span")) {
      const words = (el.textContent ?? "").trim();
      if (el.childElementCount > 0 || !/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)+$/.test(words)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.left < 0 || r.right > innerWidth || r.bottom < 0 || r.top > innerHeight) continue;
      const s = getComputedStyle(el);
      out.push(`${words}: ${s.fontFamily}|${s.fontWeight}|${s.color}|${s.letterSpacing}|${s.fontSize}`);
    }
    return out;
  });
const facesOf = (names) => names.map((n) => n.slice(n.indexOf(": ") + 2));
/** A bar's title, as it is drawn. */
const titleDrawn = (name) =>
  seen(page.getByRole("heading", { name, exact: true }))
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.fontFamily}|${s.fontWeight}|${s.color}|${s.letterSpacing}|${s.fontSize}`;
    });
/**
 * A bar's title in the stack's serif, not the typewriter's, in the bar's
 * ink, untracked, whatever its weight. The stack's own weight is its
 * platform's (the web's medium here, the system's bold on iOS); a title
 * that is a username is regular under Editorial.
 */
const serifTitle = (f) => {
  const s = drawnAs(f);
  return !MONO.test(s.face) && /serif/.test(s.face) && s.color === INK && s.spacing === "normal";
};
/**
 * On each card, its names as drawn: the first, over the picture; the one
 * leading the caption, a line of the card's own; and the one leading each
 * comment, in a button of its own. And the words those lines go on in.
 */
const namesOnCards = (cards) =>
  cards.evaluateAll((els) => {
    const NAME = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)+$/;
    const drawn = (n) => {
      const s = getComputedStyle(n);
      return `${s.fontFamily}|${s.fontWeight}|${s.color}|${s.letterSpacing}|${s.fontSize}`;
    };
    const found = { header: [], captions: [], comments: [], words: [], pairs: [] };
    for (const el of els) {
      const head = [...el.querySelectorAll("*")].find((n) => n.childElementCount === 0 && NAME.test(n.textContent ?? ""));
      if (head) found.header.push(drawn(head));
      for (const line of el.querySelectorAll("div")) {
        const lead = line.firstElementChild;
        if (lead?.tagName !== "SPAN" || !line.textContent?.startsWith(`${lead.textContent} `)) continue;
        (line.parentElement === el ? found.captions : found.comments).push(drawn(lead));
        found.words.push(drawn(line));
        found.pairs.push([drawn(lead), drawn(line)]);
      }
    }
    return found;
  });
const onHome = await namesOnCards(editorial);
const firstOf = (found) => [found.header[0], found.captions[0], found.comments[0]].join(" / ");
check(
  "Editorial: the member's name over each print is in the app's own face and ink, untracked, half bold",
  allSetAs(onHome.header, "500"),
  `${onHome.header.length}: ${onHome.header[0]}`,
);
check("Editorial: so is the name before each caption", allSetAs(onHome.captions, "500"), `${onHome.captions.length}: ${onHome.captions[0]}`);
check("Editorial: and the name before each comment", allSetAs(onHome.comments, "500"), `${onHome.comments.length}: ${onHome.comments[0]}`);
check(
  "Editorial: the captions and comments themselves are as they were: their own face and ink, regular and untracked",
  allSetAs(onHome.words, "400"),
  onHome.words[0],
);
check(
  "Editorial: a name before a caption or a comment is in the face, ink and size of the words it leads, a step heavier",
  onHome.pairs.length > 0 &&
    onHome.pairs.every(([name, words]) => allButWeight(name) === allButWeight(words) && drawnAs(name).weight === "500" && drawnAs(words).weight === "400"),
  onHome.pairs[0]?.join(" / "),
);
const offWhite = await papersOf(editorial, wordmark(), tabBar());
const strips = await editorial.evaluateAll((els) => els.filter((el) => getComputedStyle(el).borderBottomWidth !== "0px").length);
check(
  "Off-white: the prints, the screen and both bars are one paper, with nothing between the prints",
  offWhite.length === 1 && offWhite[0] === OFF_WHITE && strips === 0,
  offWhite.join(" | "),
);
await shot("12b-editorial");
// The heart on the first print, both ways and back to how it was. Home draws
// only its first few prints at first, and the member may well have liked
// every one of them (the walk liked the first above), so no print is picked
// for being unliked: the first one's heart is turned over, then back.
const editorialHeart = async (card) =>
  (await card.getByLabel("Unlike", { exact: true }).count()) > 0 ? "Unlike" : (await card.getByLabel("Like", { exact: true }).count()) > 0 ? "Like" : null;
const editorialFirst = editorial.first();
const editorialHeartWas = await editorialHeart(editorialFirst);
let editorialLike = editorialHeartWas ? "" : "no heart on the first print";
for (const step of editorialHeartWas ? [1, 2] : []) {
  const before = await editorialHeart(editorialFirst);
  await editorialFirst.getByLabel(before, { exact: true }).click();
  await wait(1500);
  const after = await editorialHeart(editorialFirst);
  if (after === before) {
    editorialLike = `tap ${step}: the heart stayed ${before}`;
    break;
  }
}
if (!editorialLike && (await editorialHeart(editorialFirst)) !== editorialHeartWas) editorialLike = `the heart did not come back to ${editorialHeartWas}`;
check("Like still works on the editorial card, both ways", editorialLike === "", editorialLike || editorialHeartWas);

// The comments on a print, and the Activity tab: every name in the list in its own face, half bold.
await editorial.first().getByLabel("Comments", { exact: true }).click();
await wait(2500);
const inComments = await namesOnScreen();
check(
  "Editorial: every name in the comments is in the app's own face and ink, untracked, half bold",
  /Add a comment/.test((await page.locator("textarea, input").last().getAttribute("placeholder")) ?? "") && allSetAs(facesOf(inComments), "500"),
  `${inComments.length}: ${inComments.slice(0, 3).join(" | ")}`,
);
await shot("12e-editorial-comments");
await back(2200);
await tab("activity");
// An unread notice is marked by its row's paper alone, so its name is set as every name is.
const inActivity = await namesOnScreen();
check(
  "Editorial: every name in Activity is in the app's own face and ink, untracked, half bold, read or not",
  allSetAs(facesOf(inActivity), "500"),
  `${inActivity.length}: ${inActivity.slice(0, 3).join(" | ")}`,
);
await shot("12f-editorial-activity");

// The inbox: a read thread's name is half bold, as every name is, and an
// unread one's is semibold, as it always was, its state coming after the face.
// In the demo only Tomas has written since it was read.
await go("/messages", 2600);
const inInbox = Object.fromEntries((await namesOnScreen()).map((n) => [n.slice(0, n.indexOf(": ")), n.slice(n.indexOf(": ") + 2)]));
const unreadName = inInbox["tomas.lindqvist"];
const readNames = Object.entries(inInbox).filter(([name]) => name !== "tomas.lindqvist").map(([, f]) => f);
check("Editorial: an unread thread's name is bold, as under Original, in its own face and ink", unreadName != null && setAs(unreadName, "600"), unreadName);
check("Editorial: a read thread's name is in its own face and ink, half bold", allSetAs(readNames, "500"), `${readNames.length}: ${readNames[0]}`);
check(
  "Editorial: an unread thread's name differs from a read one's only in its weight",
  unreadName != null && readNames.length > 0 && readNames.every((f) => allButWeight(f) === allButWeight(unreadName)),
  `${unreadName} / ${readNames[0]}`,
);
// A bar titled with other words: the stack's own title, at the stack's own
// weight, under either layout. A username's title is compared with it below.
const wordsTitle = await titleDrawn("Messages");
check(
  "Editorial: a bar titled with other words, the inbox's, keeps the stack's own title: its serif, at the stack's weight",
  serifTitle(wordsTitle) && Number(drawnAs(wordsTitle).weight) > 400,
  wordsTitle,
);
await go("/", 2400);

await choose("White");
const white = await papersOf(editorial, wordmark(), tabBar());
check("White: the prints, the screen and both bars are all white", white.length === 1 && white[0] === WHITE, white.join(" | "));
await shot("12c-editorial-white");

// A profile's photographs in feed view: the gallery a grid square opens, set out the same way, on the same paper.
const author = editorial.nth(1).locator('[role="button"]').first();
const member = (await author.getAttribute("aria-label")) ?? "";
await author.click();
await wait(2600);
// Their profile is titled with their username: in the stack's serif, ink
// and size, as the inbox's title is, but regular. It is compared with a
// profile's title under Original below.
const profileTitle = await titleDrawn(member);
check(
  "Editorial: a profile's title, its username, is the stack's serif, ink and size, and regular",
  serifTitle(profileTitle) && drawnAs(profileTitle).weight === "400" && allButWeight(profileTitle) === allButWeight(wordsTitle),
  `${member}: ${profileTitle} / ${wordsTitle}`,
);
await shot("12g-editorial-profile");
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
const galleryTitle = shownInGallery ? await titleDrawn(member) : "";
check(
  "Editorial: the gallery's title, its author's username, is drawn as the profile's is: the stack's serif, regular",
  serifTitle(galleryTitle) && galleryTitle === profileTitle,
  galleryTitle,
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
// And every username back at its own weight, bold where it was bold and
// regular where it was regular, and otherwise exactly as Editorial drew it:
// on Home, in Activity and in the inbox; and a profile's title back at the
// stack's own weight.
const homeAgain = await namesOnScreen();
check(
  "Original: every name on Home is in the app's own face, untracked",
  homeAgain.length > 0 && facesOf(homeAgain).every((f) => !MONO.test(drawnAs(f).face) && drawnAs(f).spacing === "normal"),
  homeAgain.slice(0, 3).join(" | "),
);
// The name over each picture, before each caption and before each comment: dark and bold, as they always were.
const onHomeAgain = await namesOnCards(seen(page.getByLabel(/^Posted /)).locator("xpath=.."));
check(
  "Original: the name over each picture, before each caption and before each comment is dark and bold again",
  allSetAs(onHomeAgain.header, "600") && allSetAs(onHomeAgain.captions, "600") && allSetAs(onHomeAgain.comments, "600"),
  [onHomeAgain.header.length, onHomeAgain.captions.length, onHomeAgain.comments.length].join("/") + ": " + firstOf(onHomeAgain),
);
check(
  "Original: those names are in the face, ink, tracking and size Editorial drew them in: only the weight differs",
  sameButWeight(onHome.header, onHomeAgain.header) && sameButWeight(onHome.captions, onHomeAgain.captions) && sameButWeight(onHome.comments, onHomeAgain.comments),
  `${firstOf(onHome)} | ${firstOf(onHomeAgain)}`,
);
await tab("activity");
const activityAgain = await namesOnScreen();
check("Original: every name in Activity is bold again, in its own face and ink", allSetAs(facesOf(activityAgain), "600"), activityAgain.slice(0, 3).join(" | "));
check(
  "Original: in the face, ink, tracking and size Editorial drew them in: only the weight differs",
  sameButWeight(facesOf(inActivity), facesOf(activityAgain)),
  `${facesOf(inActivity)[0]} | ${facesOf(activityAgain)[0]}`,
);
await go("/messages", 2600);
const inboxAgain = Object.fromEntries((await namesOnScreen()).map((n) => [n.slice(0, n.indexOf(": ")), n.slice(n.indexOf(": ") + 2)]));
check(
  "Original: the inbox's names are as they always were, an unread one semibold as under Editorial and a read one regular, not half bold",
  Object.keys(inboxAgain).length > 0 &&
    inboxAgain["tomas.lindqvist"] === inInbox["tomas.lindqvist"] &&
    Object.entries(inboxAgain)
      .filter(([name]) => name !== "tomas.lindqvist")
      .every(([name, f]) => setAs(f, "400") && allButWeight(f) === allButWeight(inInbox[name])),
  `${inboxAgain["tomas.lindqvist"]} / ${Object.keys(inboxAgain).length}`,
);
const wordsTitleAgain = await titleDrawn("Messages");
check("Original: a bar titled with other words is drawn exactly as under Editorial", wordsTitleAgain === wordsTitle, `${wordsTitleAgain} / ${wordsTitle}`);

await go("/user/tomas.lindqvist", 2800);
const tomasTitleDrawn = await titleDrawn("tomas.lindqvist");
check(
  "Original: a profile's title is the stack's own again, drawn exactly as a bar titled with other words",
  serifTitle(tomasTitleDrawn) && tomasTitleDrawn === wordsTitleAgain,
  `${tomasTitleDrawn} / ${wordsTitleAgain}`,
);
check(
  "Original: in the serif, ink, tracking and size Editorial drew it in: only the weight differs",
  allButWeight(tomasTitleDrawn) === allButWeight(profileTitle) && drawnAs(tomasTitleDrawn).weight !== drawnAs(profileTitle).weight,
  `${tomasTitleDrawn} / ${profileTitle}`,
);
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

// Lifted in the last row on the screen, or the top row under the bar, a
// print is held where it is while the finger settles: the page runs on at
// that edge only once the finger goes on toward it, or has been clear of
// it. Let go over its own era, it goes back, and nothing has moved.
const settle = async (locator, top, zone) => {
  await bringTo(locator, top);
  const from = await scrollerTop(locator);
  const at = await hold(locator);
  for (const [dx, dy] of [[3, 2], [-2, 4], [1, -3], [-1, 1]]) await page.mouse.move(at.x + dx, at.y + dy, { steps: 2 });
  await wait(800);
  const held = await scrollerTop(locator);
  const up = await lifted();
  const marked = (await framed()) + (await seen(page.getByTestId("era-drag-slip")).count());
  await page.mouse.up();
  const home = await putBack();
  const inZone = at.y >= zone[0] && at.y < zone[1];
  return { ok: inZone && up > 0 && !held.free && marked === 0 && home && held.top === from.top, ran: held.top - from.top, at: Math.round(at.y), zone };
};
const foot = (await scrollerTop(printOf(stays))).bottom;
const low = await settle(printOf(stays), foot - 70, [foot - 72, foot]);
// The first chapter's lead, brought up under the bar as it holds to the top of the page's view.
const barFoot = await seen(page.getByText("Arranging", { exact: true }))
  .first()
  .evaluate((el) => {
    let bar = el;
    while (bar && getComputedStyle(bar).position !== "sticky") bar = bar.parentElement;
    let s = bar?.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll|hidden)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    return bar && s ? s.getBoundingClientRect().top + bar.getBoundingClientRect().height : Number.NaN;
  });
const high = await settle(firstPrint, barFoot - 4, [barFoot, barFoot + 72]);
check(
  "Lifted in the top or the last row, it waits for the finger before the page runs on, and let go, nothing moves",
  low.ok &&
    high.ok &&
    (await heading(/^The foggy winter, 3 photographs$/)) > 0 &&
    (await heading(/^Milan 2026, 1 photograph$/)) > 0 &&
    !(await noted("Moved to The foggy winter")) &&
    !(await noted("Moved to Milan 2026")),
  JSON.stringify({ low, high }),
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

// Search ranks who the member follows above a stranger, read for the
// results alone (fetchFollowsAmong): "ar" finds clara.reyes before
// margot.dubois alphabetically, but Elena follows Margot and Margot her.
await page.getByPlaceholder("Search members").fill("ar");
await wait(1600);
{
  // Where each is drawn in the results, on screen (the tabs behind keep
  // their own text, drawn out of view).
  const height = page.viewportSize()?.height ?? 900;
  const topOf = async (name) => {
    const all = page.getByText(name, { exact: true });
    let top = -1;
    for (let i = 0; i < (await all.count()); i++) {
      const box = (await all.nth(i).isVisible()) ? await all.nth(i).boundingBox() : null;
      if (box && box.y >= 0 && box.y < height && (top < 0 || box.y < top)) top = box.y;
    }
    return top;
  };
  const margot = await topOf("margot.dubois");
  const clara = await topOf("clara.reyes");
  check("Search ranks a member followed both ways above one who only follows", margot >= 0 && clara >= 0 && margot < clara, `margot ${margot}, clara ${clara}`);
}
await page.getByPlaceholder("Search members").fill("");
await wait(400);

await go("/messages", 2600);
check("Messages inbox renders", /tomas|june|arthur/i.test(await text()));
await shot("16-messages");

// A thread reaches the member it is with (App Review Guideline 1.2): the
// "…" beside the title reports or blocks them, and the title opens their
// profile. The report is opened, not sent; the block is asked, not made.
{
  await byText("tomas.lindqvist").first().click();
  await wait(2600);
  const threadPath = new URL(page.url()).pathname;
  const more = byLabel("More");
  const hasMore = (await more.count()) > 0;
  const asked = dialogs.length;
  promptChoice = "Report member";
  if (hasMore) await more.last().click();
  await wait(2200);
  promptChoice = null;
  const menu = dialogs[asked] ?? "";
  const reporting = new URL(page.url());
  check(
    "A thread's … offers View profile, Report member and Block member, and reports the member it is with",
    hasMore &&
      /^tomas\.lindqvist/.test(menu) &&
      /View profile/.test(menu) &&
      /Report member/.test(menu) &&
      /Block member/.test(menu) &&
      reporting.pathname === "/report" &&
      reporting.searchParams.get("targetType") === "profile" &&
      Boolean(reporting.searchParams.get("profileId")),
    `${threadPath}: ${hasMore ? "…" : "no …"} → ${reporting.pathname}${reporting.search}`,
  );
  await back(2200);
  const blockAsked = dialogs.length;
  promptChoice = "Block member";
  answers.push(false);
  if (hasMore) await byLabel("More").last().click();
  await wait(1600);
  promptChoice = null;
  check(
    "Blocking from a thread asks first, in the profile's words, and Cancel leaves the thread as it was",
    /^Block tomas\.lindqvist\?/.test(dialogs[blockAsked + 1] ?? "") &&
      /Neither of you is told\. You can unblock from Settings\./.test(dialogs[blockAsked + 1] ?? "") &&
      new URL(page.url()).pathname === threadPath,
    (dialogs[blockAsked + 1] ?? "no dialog").split("\n")[0],
  );
  await seen(page.getByRole("link", { name: "tomas.lindqvist" })).first().click();
  await wait(2600);
  check(
    "A thread's title opens the profile of the member it is with",
    new URL(page.url()).pathname === "/user/tomas.lindqvist" && /tomas\.lindqvist/.test(await text()),
    new URL(page.url()).pathname,
  );
}

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

// ===========================================================================
// PHASE C — the door signed in, Settings' switches, a reported comment
// ===========================================================================

// Signed in, an invitation link goes into the app. Left on the card, a
// second account could be made over this one, and a join refused after
// its account was made left the new member there for good.
await go("/invite/someone-invitation", 3400);
check(
  "A signed-in member who opens an invitation link goes into the app, not onto the card",
  new URL(page.url()).pathname === "/" &&
    (await byText("Accept the invitation").count()) === 0 &&
    (await seen(page.locator('[role="tab"]')).count()) > 0,
  page.url(),
);

// An admin page opened by its address by a member who is not an admin
// sends them home: it used to show Suspend and Approve buttons whose calls
// the database then refused.
for (const admin of ["/admin/members", "/admin/applications", "/admin/reports"]) {
  await go(admin, 3000);
  check(
    `A member who is not an admin, opening ${admin} by its address, is sent home`,
    !/\/admin/.test(new URL(page.url()).pathname) &&
      (await byText("Suspend").count()) === 0 &&
      (await byText("Approve").count()) === 0 &&
      (await byText("Dismiss").count()) === 0 &&
      (await seen(page.locator('[role="tab"]')).count()) > 0,
    page.url(),
  );
}
// An address the app does not know goes home, signed in as here, never to
// the router's own page with its sitemap of every route.
await go("/no-such-page", 3000);
check(
  "Signed in, an unknown address goes home",
  !/no-such-page/.test(page.url()) &&
    (await seen(page.locator('[role="tab"]')).count()) > 0 &&
    !/Unmatched Route|Sitemap/.test(await text()),
  page.url(),
);

// The private account switch does what it says when it is flipped: it
// used to wait for Save, and going back left the account as it was.
const privateSwitch = () => byLabel("Private account").first();
const openSettings = async () => {
  await tab("profile");
  await byLabel("Settings").first().click();
  await wait(2200);
};
await openSettings();
const wasPrivate = await privateSwitch().isChecked();
await privateSwitch().click();
await wait(1200);
await back(1600);
await openSettings();
check("The private account switch holds once flipped, without Save", (await privateSwitch().isChecked()) === !wasPrivate);
await privateSwitch().click();
await wait(1200);
await back(1600);
await openSettings();
check("…and flipped back, it holds back", (await privateSwitch().isChecked()) === wasPrivate);
await back(1600);

// A reported comment: held a moment, reported, and an admin can remove it
// from the queue, where a comment's report used to offer only Dismiss.
// It is reported twice, as two members would: one removal closes both,
// where the second report's own Remove used to remove it again and send
// its author another notice.
const reportTheComment = async (first) => {
  await tab("home");
  await cardOf("forgives everything").getByLabel("Comments", { exact: true }).first().click();
  await wait(2500);
  // The comment as it is drawn on top: the feed's preview of it lies under this screen.
  const reported = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[dir="auto"]')) {
      if (!/The emptiness makes it\./.test(el.textContent ?? "")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const at = { x: r.x + 12, y: r.y + Math.min(r.height, 20) / 2 };
      const hit = document.elementFromPoint(at.x, at.y);
      if (hit && (hit === el || el.contains(hit))) return at;
    }
    return null;
  });
  await page.mouse.move(reported?.x ?? 0, reported?.y ?? 0);
  await page.mouse.down();
  await wait(900);
  await page.mouse.up();
  await wait(1900);
  if (first) check("Holding another member's comment offers to report it", /Report comment/.test(dialogs.at(-1) ?? "") && /\/report/.test(page.url()), page.url());
  await tap("Harassment or abuse", 600);
  await tap("Send report", 2200);
  check(first ? "The comment's report is sent, once" : "…and a second report on the same comment is sent", /An admin will take a look/.test(dialogs.at(-1) ?? ""));
  await toTabs();
};
await reportTheComment(true);
await reportTheComment(false);

// A photograph she reports leaves her own feed the moment the report is
// in (Guideline 1.2), and a read of the feed after does not bring it back.
await tab("home");
const ferryCards = () => cardOf("Last ferry of the evening").getByLabel("Post options", { exact: true }).count();
const ferryBefore = await ferryCards();
promptChoice = "Report post";
await cardOf("Last ferry of the evening").getByLabel("Post options", { exact: true }).first().click();
await wait(2200);
promptChoice = null;
const onReport = /\/report/.test(page.url());
await tap("Spam or scam", 600);
await tap("Send report", 2400);
await toTabs();
await tab("home", 3000);
check(
  "A photograph she reports leaves her own feed at once",
  ferryBefore > 0 && onReport && /An admin will take a look/.test(dialogs.at(-1) ?? "") && (await ferryCards()) === 0,
  `${ferryBefore} before, ${await ferryCards()} after`,
);

// Reported from its own page (opened here from a thread), Done closes that
// page too, back to the thread: the page beneath the report used to show
// the photograph she had just reported, as if nothing had happened. Gone
// to by tapping, not by address: a reload would forget the reports above.
await tab("home");
await byLabel("Messages").first().click();
await wait(2400);
await byText("tomas.lindqvist").first().click();
await wait(2600);
const sharedAt = await page.evaluate(() => {
  for (const img of document.querySelectorAll("img")) {
    if (!/sthlm-ice/.test(img.getAttribute("src") ?? "")) continue;
    const r = img.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return null;
});
if (sharedAt) await page.mouse.click(sharedAt.x, sharedAt.y);
await wait(2600);
const onItsPage = /\/post\/demo-post-06$/.test(new URL(page.url()).pathname);
promptChoice = "Report post";
await seen(page.getByLabel("Post options", { exact: true })).last().click();
await wait(2200);
promptChoice = null;
const reportingIt = /\/report/.test(page.url());
await tap("Spam or scam", 600);
await tap("Send report", 2600);
check(
  "Reported from its own page, the photograph's page closes too, back to where it was opened",
  Boolean(sharedAt) && onItsPage && reportingIt && /An admin will take a look/.test(dialogs.at(-1) ?? "") &&
    new URL(page.url()).pathname === "/messages/demo-convo-01",
  `${sharedAt ? "opened" : "no shared photograph"}; ${onItsPage}; ${reportingIt}; now ${new URL(page.url()).pathname}`,
);
await signOutFromSettings();
await signInAs("admin@vintage.club");
await tab("profile");
await byLabel("Admin").first().click();
await wait(2300);
await tap("Reports", 2600);
const queueNow = await text();
const commentReports = (t) => (t.match(/comment · reported by elena\.marchetti/g) ?? []).length;
check(
  "A reported comment can be removed from the reports queue",
  commentReports(queueNow) === 2 && (await byText("Remove comment").count()) === 2,
  `${commentReports(queueNow)} open reports on it`,
);
check(
  "Each report on it shows the comment's own words, so it is never removed unseen",
  (queueNow.match(/“The emptiness makes it\./g) ?? []).length === 2,
  `${(queueNow.match(/“The emptiness makes it\./g) ?? []).length} shown`,
);
await shot("19-comment-report");
await tap("Remove comment", 2600);
const queueAfter = await text();
check(
  "Removed once, every open report on the comment leaves the queue",
  commentReports(queueAfter) === 0 && (await byText("Remove comment").count()) === 0,
  `${commentReports(queueAfter)} still open`,
);
await tap("resolved", 2200);
const resolvedNow = await text();
check(
  "…and both are resolved as content removed",
  commentReports(resolvedNow) === 2 && /Content removed/.test(resolvedNow),
  `${commentReports(resolvedNow)} resolved`,
);

// Opened on an invitation, with nothing behind the card, its back mark
// still leads to the door. It used to go back to nothing at all.
{
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const card = await fresh.newPage();
  card.on("pageerror", (e) => errors.push("fresh: " + e.message));
  await card.goto(B + "/invite/someone-invitation", { waitUntil: "networkidle" });
  await card.waitForTimeout(2600);
  const onCard = /By invitation/.test((await card.textContent("body")) ?? "");
  await card.getByLabel("Back", { exact: true }).locator("visible=true").first().click();
  await card.waitForTimeout(2400);
  check(
    "Opened on an invitation, the card's back mark leads to the door",
    onCard && (await card.getByText("Apply for membership", { exact: true }).locator("visible=true").count()) > 0,
    card.url(),
  );
  await fresh.close();
}

// Signed out, an unknown address goes to the door.
{
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const lost = await fresh.newPage();
  lost.on("pageerror", (e) => errors.push("unknown address: " + e.message));
  await lost.goto(B + "/no-such-page", { waitUntil: "networkidle" });
  await lost.waitForTimeout(2600);
  const body = (await lost.textContent("body")) ?? "";
  check(
    "Signed out, an unknown address goes to the door, never to the router's sitemap",
    !/no-such-page/.test(lost.url()) &&
      (await lost.getByText("Apply for membership", { exact: true }).locator("visible=true").count()) > 0 &&
      !/Unmatched Route|Sitemap/.test(body),
    lost.url(),
  );
  await fresh.close();
}

// A bar at the door keeps its label clear of its arrow: at the default
// size in the same place as before, and at a much larger size (drawn here
// at 60 pixels, wider than the bar less its clearances, as the largest
// accessibility sizes would draw a longer label) wrapped between the two
// clearances rather than under the arrow. On the narrowest phone (320
// wide) the door's longest bar label, "I have an invitation" on the
// waiting screen, still takes one line at the default size.
{
  const fresh = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const door = await fresh.newPage();
  door.on("pageerror", (e) => errors.push("door bar: " + e.message));
  await door.goto(B + "/sign-in", { waitUntil: "networkidle" });
  await door.waitForTimeout(2400);
  const measure = (px, words) =>
    door.evaluate(([size, text]) => {
      const bar = [...document.querySelectorAll('[role="button"][aria-label="Sign in"]')].find(
        (el) => el.getBoundingClientRect().width > 200,
      );
      const label = bar && [...bar.querySelectorAll('[dir="auto"]')].find((el) => /^sign in$/i.test(el.textContent ?? ""));
      const arrow = bar && [...bar.children].find((el) => el !== label && !el.contains(label));
      if (!bar || !label || !arrow) return null;
      // Each measure starts from the page's own size, whatever the one before it drew.
      if (label.dataset.fs === undefined) label.dataset.fs = label.style.fontSize;
      label.style.fontSize = size ? `${size}px` : label.dataset.fs;
      if (text) label.textContent = text;
      const b = bar.getBoundingClientRect();
      const l = label.getBoundingClientRect();
      const a = arrow.getBoundingClientRect();
      return {
        bar: Math.round(b.width),
        left: Math.round(l.left - b.left),
        right: Math.round(b.right - l.right),
        arrow: Math.round(b.right - a.left),
        lines: Math.round(l.height / (size ? size : 11)),
      };
    }, [px, words]);
  const normal = await measure(0);
  const large = await measure(60);
  await door.setViewportSize({ width: 320, height: 640 });
  await door.waitForTimeout(400);
  const narrow = await measure(0, "I have an invitation");
  check(
    "A bar's label at the door is centred and on one line at the default size, even 320 wide, and clear of its arrow at a large size",
    Boolean(normal && large && narrow) &&
      Math.abs(normal.left - normal.right) <= 3 &&
      normal.lines === 1 &&
      narrow.lines === 1 &&
      large.lines > 1 &&
      large.right >= large.arrow + 2 &&
      large.left >= large.arrow,
    JSON.stringify({ normal, large, narrow }),
  );
  await fresh.close();
}

// An invitation's web address, should it ever open the app, goes to the
// invitation with its code, not home with the code lost.
{
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const link = await fresh.newPage();
  link.on("pageerror", (e) => errors.push("invitation address: " + e.message));
  await link.goto(B + "/i/someone-invitation", { waitUntil: "networkidle" });
  await link.waitForTimeout(2600);
  const filled = await link
    .locator("input:not([type=checkbox])")
    .locator("visible=true")
    .first()
    .inputValue()
    .catch(() => "");
  check(
    "An invitation's web address opens the invitation with its code in it",
    /By invitation/.test((await link.textContent("body")) ?? "") && filled === "someone-invitation",
    `${link.url()} · ${filled || "empty"}`,
  );
  await fresh.close();
}

console.log("\nJS errors:", errors.length ? errors.slice(0, 10) : "none");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log("FAILED: " + failed.map((r) => r.name).join(" | "));
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
