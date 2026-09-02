#!/usr/bin/env node
/**
 * Build the house accounts.
 *
 * Reads the curated photographs and writes one SQL file that creates the
 * accounts, their photographs, and a plausible amount of activity between
 * them. Deterministic: the same photos.json produces byte-identical SQL, so
 * re-running it is a diff rather than a surprise.
 *
 * Nothing here writes to a database. The output goes to
 * supabase/production/08_house_accounts.sql and is applied by hand.
 *
 *   node seed/build.mjs [--members 150] [--posts 6]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isLikelyPhotograph } from "./photoFilter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const MEMBERS = arg("members", 150);
const POSTS_EACH = arg("posts", 6);

/** Deterministic PRNG — the same seed gives the same club every time. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(0x56494e54); // "VINT"
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;

/** A stable uuid from the member index, so ids never move between runs. */
function houseUuid(n) {
  const hex = n.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-000000000000`;
}
function postUuid(m, p) {
  return `${m.toString(16).padStart(8, "0")}-0000-4000-8001-${p.toString(16).padStart(12, "0")}`;
}

const FIRST = [
  "Ana","Mateo","Yuki","Ingrid","Omar","Clara","Tomas","Noor","Hugo","Sofia","Kenji","Lena",
  "Rafael","Amara","Nils","Beatriz","Idris","Margot","Elias","Zaid","Hana","Piet","Rosa","Karim",
  "Freya","Lucca","Selin","Anders","Camille","Dario","Esther","Fabio","Greta","Hassan","Iris",
  "Jonas","Kaia","Leo","Marta","Nadia","Oscar","Paloma","Quentin","Ruth","Sami","Tilda","Ugo",
  "Vera","Wim","Xavier","Yara","Zoe","Bruno","Delphine","Emil","Giulia","Halim","Ivar","Juno",
  "Kofi","Livia","Malik","Nour","Otto","Pia","Reza","Saskia","Thea","Uma","Viktor","Wanda",
];
const LAST = [
  "Alvarez","Bianchi","Costa","Dahl","Eriksen","Fontaine","Gallo","Haddad","Ibarra","Jansen",
  "Kowal","Lindqvist","Moreau","Nakamura","Okafor","Pereira","Quintana","Rossi","Salvatore",
  "Takahashi","Ueda","Vasquez","Wexler","Ximenes","Yilmaz","Zanetti","Baptiste","Cardoso",
  "Delacroix","Engel","Ferrante","Grimaldi","Holm","Iversen","Jarvis","Klein","Lombardi",
  "Mendes","Novak","Ortiz","Petrov","Rahman","Sorensen","Tanaka","Urban","Volkov","Weiss",
];
const CITIES = [
  "Lisbon","Milan","Kyoto","Copenhagen","Mexico City","Marseille","Tangier","Athens","Naples",
  "Porto","Barcelona","Istanbul","Buenos Aires","Montreal","Cape Town","Beirut","Palermo",
  "Valparaíso","Trieste","Seville","Hanoi","Oaxaca","Reykjavík","Tbilisi","Cartagena","Bruges",
  "Ljubljana","San Sebastián","Bologna","Ghent","Antwerp","Helsinki","Zagreb","Rabat","Amman",
  "Cádiz","Rovinj","Split","Sofia","Kraków","Bergen","Tallinn","Vilnius","Salvador","Recife",
];
const BIOS = [
  "Mostly at dusk.","Film only. Badly.","Notes from wherever I am.","Two rolls a month, if that.",
  "Slow shutter, slower life.","I photograph the quiet parts.","Rooms, mostly.","Records and rooftops.",
  "Kitchen table still lifes.","Always one frame short.","Walking, looking.","Grain over sharpness.",
  "Afternoons.","Old lenses, new places.","Nothing staged.","A working archive.","Chasing the light home.",
  "Overexposed and unbothered.","Windows, doors, weather.","I keep the outtakes.","Colour when it earns it.",
  "Half of these are mistakes.","For the record.","Only when it's worth it.","Whatever the light does.",
];
const CAPTIONS = {
  poolside: ["Nobody in the water until four.","Deep end, all afternoon.","Chlorine and paperbacks.","The good chair was taken.","Waited out the heat."],
  desert: ["Air like an oven door.","Nothing for an hour in any direction.","Shade is a luxury good.","Left before the wind picked up.","Dry season."],
  riviera: ["Long lunch, longer walk back.","The good coffee is up the hill.","Same table as last year.","Off season, thankfully.","Salt on everything."],
  sea: ["Out past the breakers.","Cold, then fine.","Tide took the afternoon.","Wind dropped at six.","Stayed until it went grey."],
  music: ["Second set was the one.","Loud room, good room.","Stayed for the encore.","Somebody knew every word.","Found it in the back racks."],
  art: ["Went for one room, stayed for three.","Empty on a Tuesday.","Worth the queue.","Kept coming back to this corner.","Better in person."],
  americana: ["Roadside, mid-afternoon.","Everything open, nobody in.","Two hundred miles to the next one.","Neon does the work.","Stopped for coffee, stayed an hour."],
  clothing: ["Everything fits somebody.","Third fitting.","Kept the buttons.","Found in the back of the shop.","Worn in, not worn out."],
  travel: ["First morning, before the crowds.","Got lost properly.","Same street, different hour.","Walked it twice.","Missed the last one back."],
  mountains: ["Above the cloud by nine.","Colder than it looks.","Turned back at the ridge.","Snow held all week.","Last light on the way down."],
  interiors: ["Sat here most of the week.","Somebody else's good taste.","Quiet as a library, being one.","Rearranged nothing.","The chair does most of it."],
  cars: ["Runs, mostly.","Parked in the same spot for years.","Somebody loves this thing.","Original paint.","Started first time."],
  food: ["Everything at the market was better.","Ate standing up.","Second breakfast.","Whatever they had.","Worth the detour."],
  still: ["On the table all week.","Morning light does this once.","Not moving it.","Still here.","Same corner, better hour."],
  // The contemporary set carries no subject metadata, so nothing here
  // claims to know what is in the frame.
  modern: [
    "Finally got round to posting this.","Sunday.","No notes.","One of six that worked.",
    "Been sitting on this roll for months.","Worth the walk.","Late light.","Straight out of the camera.",
    "Third attempt.","Kept this one.","Morning.","Not sure about this one, posting it anyway.",
    "The last frame.","Somewhere better than here.","Quiet week.","Been meaning to share this.",
    "Found this on an old card.","Nothing else from that day came out.","Good hour for it.","Still my favourite.",
  ],
};
const COMMENTS = [
  "This is the one.","Beautiful light.","Where is this?","Perfect.","The grain on this.","Stunning.",
  "Been waiting for this roll.","Frame it.","So good.","This colour.","Unreal.","My favourite of yours.",
  "That corner!","Yes.","Extraordinary.","Wonderful.","Immaculate.","This stopped me.","Gorgeous.",
  "How did you get this?","Love this one.","Incredible tones.","Perfect timing.","Wow.","Superb.",
];
const FILTERS = [
  "archive-bw","seventy","alpine","riviera","ninety-eight","instant","chrome-64",
  "neutral-aged","ember","bleach","cassette","peach","midnight","postcard",
];

// ---------------------------------------------------------------------------
const { photos: allPhotos } = JSON.parse(readFileSync(join(here, "photos.json"), "utf8"));
// photos.json may have been curated by an older, looser rule set. Re-apply
// the current one here so the seed can never be worse than the filter.
const photos = allPhotos.filter((p) => isLikelyPhotograph(p.file, ""));
if (photos.length < allPhotos.length) {
  console.log(`${allPhotos.length - photos.length} photographs rejected by the current rules`);
}
if (photos.length < MEMBERS * POSTS_EACH) {
  console.warn(
    `! only ${photos.length} photographs for ${MEMBERS * POSTS_EACH} posts — some will repeat`,
  );
}

// One queue per theme, deterministically shuffled, drawn from without
// replacement. A member picks themes, not individual photographs, so a grid
// hangs together — but no photograph appears twice while any unused one
// remains, which a per-theme cursor could not promise: the pools are wildly
// uneven, and members drawing from a small pool used to circle it.
const byTheme = {};
for (const p of photos) (byTheme[p.theme] ??= []).push(p);
for (const t of Object.keys(byTheme)) {
  byTheme[t].sort((a, b) => a.file.localeCompare(b.file));
  for (let i = byTheme[t].length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [byTheme[t][i], byTheme[t][j]] = [byTheme[t][j], byTheme[t][i]];
  }
}

const remaining = () => Object.keys(byTheme).filter((t) => byTheme[t].length > 0);

/** A theme chosen in proportion to how much of it is left, so the big pools
 * carry the bulk and the small ones are not worn out. */
// The contemporary photographs should carry most of the club: a feed made
// entirely of 1920s archive material is handsome but reads as a museum,
// not as people posting this year. The archival themes stay in as a
// minority, which suits an app called VINTAGE.
const WEIGHT = { modern: 9 };
function weightedTheme() {
  const live = remaining();
  if (live.length === 0) return null;
  const weigh = (t) => byTheme[t].length * (WEIGHT[t] ?? 1);
  const total = live.reduce((n, t) => n + weigh(t), 0);
  let r = rand() * total;
  for (const t of live) {
    r -= weigh(t);
    if (r <= 0) return t;
  }
  return live[live.length - 1];
}

let exhausted = 0;
function nextPhoto(theme) {
  const queue = byTheme[theme];
  if (queue && queue.length > 0) return queue.pop();
  // That theme is spent; fall back to whatever is left rather than repeat.
  const other = weightedTheme();
  if (other) return byTheme[other].pop();
  exhausted += 1;
  return null;
}

const usernames = new Set();
function username(first, last) {
  const base = `${first}.${last}`.toLowerCase().normalize("NFD").replace(/[^a-z0-9_.]/g, "");
  let name = base.slice(0, 22);
  let n = 2;
  while (usernames.has(name)) name = `${base.slice(0, 20)}${n++}`;
  usernames.add(name);
  return name;
}

const DAY = 86_400_000;
const now = Date.now();

const members = [];
const posts = [];
for (let i = 1; i <= MEMBERS; i++) {
  const first = pick(FIRST);
  const last = pick(LAST);
  // One or two subjects each, so a grid reads like a person rather than a
  // shuffle of everything.
  const interests = [weightedTheme()].filter(Boolean);
  if (chance(0.55)) {
    const second = weightedTheme();
    if (second) interests.push(second);
  }
  if (interests.length === 0) break;

  const joined = now - Math.floor(rand() * 700 + 30) * DAY;
  const member = {
    id: houseUuid(i),
    username: username(first, last),
    full_name: `${first} ${last}`,
    city: pick(CITIES),
    bio: pick(BIOS),
    is_private: chance(0.07),
    created_at: new Date(joined).toISOString(),
    avatar: null,
  };

  const count = POSTS_EACH + (chance(0.35) ? Math.floor(rand() * 5) - 2 : 0);
  for (let j = 0; j < Math.max(3, count); j++) {
    const theme = pick(interests);
    const photo = nextPhoto(theme);
    if (!photo) break; // the pool is spent; this member simply posts less
    if (!member.avatar) member.avatar = photo.thumb;
    const posted = joined + Math.floor(rand() * (now - joined));
    posts.push({
      id: postUuid(i, j),
      author: member.id,
      url: photo.url,
      thumb: photo.thumb,
      width: photo.width,
      height: photo.height,
      filter: pick(FILTERS),
      // The stamp is only honest when the file recorded a capture date.
      stamp: Boolean(photo.takenAt) && chance(0.5),
      caption: chance(0.75) ? pick(CAPTIONS[theme] ?? CAPTIONS.still) : "",
      // Only claim a place when the search that found the photograph was
      // itself a place.
      location: photo.place,
      takenAt: photo.takenAt,
      createdAt: new Date(posted).toISOString(),
    });
  }
  // A member with no photographs is just an empty grid; skip them.
  if (posts.some((p) => p.author === member.id)) members.push(member);
}
if (exhausted > 0) {
  console.warn(`! ran out of photographs; ${exhausted} posts dropped`);
}

const q = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

const lines = [];
lines.push(`-- VINTAGE · production · house accounts
--
-- Generated by seed/build.mjs from seed/photos.json. Do not edit by hand —
-- re-run the builder.
--
--   ${members.length} accounts, ${posts.length} photographs
--   generated ${new Date().toISOString()}
--
-- These are house accounts, not people. They exist so that Explore and
-- Search are not empty when the first real members arrive. Every one is
-- flagged is_house, which is what keeps them out of the membership
-- numbering: migration 0011 makes assign_member_no refuse them before it
-- touches the sequence, so your first real invitation is still no. 00002.
--
-- None of them can sign in: the auth rows are created with no password and
-- no identity, so there is nothing to authenticate against.
--
-- Every photograph is public domain or CC0 — see seed/CREDITS.md for the
-- full list with sources. Requires migration 0011.
--
-- To remove the whole thing later:
--   delete from auth.users where id in (select id from public.profiles where is_house);

do $seed$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_house'
  ) then
    raise exception 'Apply migration 0011_house_accounts.sql first.';
  end if;
end
$seed$;

begin;
`);

lines.push("-- accounts -----------------------------------------------------------------");
lines.push("insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values");
lines.push(members.map((m) =>
  `  ('00000000-0000-0000-0000-000000000000', ${q(m.id)}, 'authenticated', 'authenticated', ` +
  `${q(`${m.username}@house.vintage.invalid`)}, now(), '{"provider":"house","providers":["house"]}'::jsonb, ` +
  `${q(JSON.stringify({ username: m.username, full_name: m.full_name }))}::jsonb, ${q(m.created_at)}, ${q(m.created_at)})`
).join(",\n") + "\non conflict (id) do nothing;\n");

lines.push("-- the trigger made a profile for each; fill it in and flag it -------------");
lines.push(`update public.profiles p set
  full_name = v.full_name, bio = v.bio, city = v.city, avatar_url = v.avatar,
  status = 'approved', approved_at = v.created_at, created_at = v.created_at,
  is_private = v.is_private, is_house = true, invite_quota = 0
from (values`);
lines.push(members.map((m) =>
  `  (${q(m.id)}::uuid, ${q(m.full_name)}, ${q(m.bio)}, ${q(m.city)}, ${q(m.avatar)}, ${q(m.created_at)}::timestamptz, ${m.is_private})`
).join(",\n"));
lines.push(") as v(id, full_name, bio, city, avatar, created_at, is_private)\nwhere p.id = v.id;\n");

lines.push("-- photographs ---------------------------------------------------------------");
lines.push("insert into public.posts (id, author_id, media_type, media_path, thumb_path, width, height, filter_id, show_date_stamp, caption, taken_at, location, created_at) values");
lines.push(posts.map((p) =>
  `  (${q(p.id)}, ${q(p.author)}, 'photo', ${q(p.url)}, ${q(p.thumb)}, ${p.width}, ${p.height}, ` +
  `${q(p.filter)}, ${p.stamp}, ${q(p.caption)}, ${p.takenAt ? q(p.takenAt) : "null"}, ${q(p.location)}, ${q(p.createdAt)})`
).join(",\n") + "\non conflict (id) do nothing;\n");

lines.push(`-- follows, likes and conversation -------------------------------------------
--
-- Generated here rather than enumerated: a deterministic hash of the two
-- ids decides each edge, which keeps this file small and the result stable.
-- The counter triggers do the counting, so follower/like/comment totals are
-- real rather than asserted.
do $graph$
declare
  v_comments text[] := array[${COMMENTS.map(q).join(", ")}];
begin
  -- each account follows roughly a dozen others
  insert into public.follows (follower_id, followee_id, status)
  select a.id, b.id, 'accepted'
  from public.profiles a
  join public.profiles b on b.id <> a.id and b.is_house
  where a.is_house
    and abs(hashtext(a.id::text || b.id::text)) % 100 < 8
  on conflict do nothing;

  -- likes, weighted so some photographs clearly did better than others
  insert into public.likes (post_id, user_id)
  select p.id, m.id
  from public.posts p
  join public.profiles m on m.is_house and m.id <> p.author_id
  where p.author_id in (select id from public.profiles where is_house)
    and abs(hashtext(p.id::text || m.id::text)) % 100
        < (3 + abs(hashtext(p.id::text)) % 12)
  on conflict do nothing;

  -- a comment here and there, never a thread
  insert into public.comments (post_id, author_id, body, created_at)
  select p.id, m.id,
         v_comments[1 + abs(hashtext(p.id::text || m.id::text)) % array_length(v_comments, 1)],
         p.created_at + (abs(hashtext(m.id::text || p.id::text)) % 72) * interval '1 hour'
  from public.posts p
  join public.profiles m on m.is_house and m.id <> p.author_id
  where p.author_id in (select id from public.profiles where is_house)
    and abs(hashtext(m.id::text || p.id::text || 'c')) % 100 < 3;
end
$graph$;

commit;

-- what landed
select
  (select count(*) from public.profiles where is_house)                as house_accounts,
  (select count(*) from public.profiles where is_house and member_no is not null) as should_be_zero,
  (select count(*) from public.posts
     where author_id in (select id from public.profiles where is_house)) as photographs,
  (select count(*) from public.follows)                                 as follows,
  (select count(*) from public.likes)                                   as likes,
  (select count(*) from public.comments)                                as comments,
  (select last_value from public.member_no_seq)                         as member_no_seq;`);

const sql = lines.join("\n");
const out = join(here, "..", "supabase", "production", "08_house_accounts.sql");
writeFileSync(out, sql);

// Credits: not legally required for PD/CC0, but the sources should be
// traceable by anyone who asks where a photograph came from.
const used = new Map();
for (const p of posts) used.set(p.url, p);
const credits = [
  "# House photographs — sources",
  "",
  `${used.size} photographs, all public domain or CC0, curated from Wikimedia`,
  "Commons by `seed/curate.mjs`. None of these licences requires attribution;",
  "this list exists so the provenance of anything in the seeded feed can be",
  "traced back to its source file.",
  "",
  "| File | Licence | Author |",
  "| --- | --- | --- |",
];
for (const [, p] of used) {
  const photo = photos.find((x) => x.url === p.url);
  credits.push(
    `| [${(photo?.file ?? "").replace(/^File:/, "").replace(/\|/g, "-")}](${photo?.descriptionUrl ?? ""}) ` +
    `| ${photo?.licence ?? ""} | ${(photo?.author ?? "—").replace(/\|/g, "-").slice(0, 60)} |`,
  );
}
writeFileSync(join(here, "CREDITS.md"), credits.join("\n") + "\n");

console.log(`${members.length} accounts, ${posts.length} photographs, ${used.size} distinct images`);
console.log(`→ ${out}`);
console.log(`→ ${join(here, "CREDITS.md")}`);
