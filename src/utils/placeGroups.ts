/**
 * A member's photographs sorted into the places they were taken.
 *
 * A profile read as places is a set of headings — New York, Lisbon, the
 * Catskills — each with every photograph made there beneath it. The
 * heading is the town, not the spot: "Bar Pitti" and "The Met" are both
 * New York, and the spots are listed small under the town's name. The
 * town comes from the photograph's point, looked up on the phone (see
 * `reverseGeocode.ts`); a photograph with words but no point is filed
 * under the words it carries; one with neither goes last, under no name.
 *
 * Pure: the lookup is passed in, so this can be tested without a map.
 */

export interface PlaceLabel {
  /** The town or city, as the map names it. */
  city: string | null;
  /** State, province, département. */
  region: string | null;
  country: string | null;
}

export interface PlaceGroup<T> {
  /** Stable, case-folded key: the title, or `UNPLACED` for photographs with no place. */
  key: string;
  /** "New York" — or the words the author wrote, when the map knows nothing more. */
  title: string;
  /** "United States" — where it adds to the title; null otherwise. */
  subtitle: string | null;
  /** The spots within, most photographed first: "Bar Pitti", "The Met". At most `SPOTS_SHOWN`. */
  spots: string[];
  /** How many more spots there were than are named. */
  more: number;
  /** "2021" or "2019–2024" — the years the photographs span. */
  years: string | null;
  /** Newest first, by the day the shutter fired. */
  posts: T[];
  /** False for the one group of photographs that name no place at all. */
  placed: boolean;
}

export interface PlaceablePost {
  id: string;
  location: string | null;
  taken_at: string | null;
  created_at: string;
}

export const UNPLACED = "~unplaced";
export const UNPLACED_TITLE = "No place given";
export const SPOTS_SHOWN = 3;

/**
 * Nearby points share one lookup. A cell is about five kilometres on a
 * side — well inside any town, so every photograph from it asks once.
 */
export const CELL_DEGREES = 0.05;

export function cellKey(lat: number, lng: number): string {
  return `${Math.round(lat / CELL_DEGREES)}:${Math.round(lng / CELL_DEGREES)}`;
}

/** What the phone's geocoder hands back, reduced to the three names we keep. */
export function labelFromAddress(a: {
  city?: string | null;
  subregion?: string | null;
  district?: string | null;
  region?: string | null;
  country?: string | null;
}): PlaceLabel {
  const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  return {
    // A village may come back as a subregion or district rather than a city.
    city: clean(a.city) ?? clean(a.subregion) ?? clean(a.district),
    region: clean(a.region),
    country: clean(a.country),
  };
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function when(p: PlaceablePost): string {
  return p.taken_at ?? p.created_at;
}

/**
 * Two of the server's timestamps, newest first. They are ISO strings in one
 * format, so their characters already sort by time: compared as they are,
 * not through the locale's collation, which the phone's runtime does a
 * character at a time, for every comparison a sort makes.
 */
function newerFirst(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

function yearOf(iso: string): number | null {
  const y = new Date(iso).getFullYear();
  return Number.isFinite(y) ? y : null;
}

/** "2021", or "2019–2024" with an en dash. */
export function yearSpan(posts: readonly PlaceablePost[]): string | null {
  const years = posts.map((p) => yearOf(when(p))).filter((y): y is number => y !== null);
  if (years.length === 0) return null;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}–${max}`;
}

/** The heading a photograph files under, given what the map said about its point. */
export function titleFor(post: PlaceablePost, label: PlaceLabel | null): string | null {
  const fromMap = label?.city ?? label?.region ?? label?.country ?? null;
  if (fromMap) return fromMap;
  const words = post.location?.trim();
  return words ? words : null;
}

export function groupByPlace<T extends PlaceablePost>(posts: readonly T[], labelFor: (post: T) => PlaceLabel | null): PlaceGroup<T>[] {
  type Draft = { title: string; posts: T[]; labels: PlaceLabel[]; spots: Map<string, { name: string; n: number }> };
  const drafts = new Map<string, Draft>();

  for (const post of posts) {
    const label = labelFor(post);
    const title = titleFor(post, label);
    const key = title ? norm(title) : UNPLACED;
    let d = drafts.get(key);
    if (!d) {
      d = { title: title ?? UNPLACED_TITLE, posts: [], labels: [], spots: new Map() };
      drafts.set(key, d);
    }
    d.posts.push(post);
    if (label) d.labels.push(label);
    const spot = post.location?.trim();
    if (spot && norm(spot) !== key) {
      const s = d.spots.get(norm(spot));
      if (s) s.n += 1;
      else d.spots.set(norm(spot), { name: spot, n: 1 });
    }
  }

  const groups: PlaceGroup<T>[] = [...drafts.entries()].map(([key, d]) => {
    const placed = key !== UNPLACED;
    const spots = [...d.spots.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const sorted = [...d.posts].sort((a, b) => newerFirst(when(a), when(b)));
    return {
      key,
      title: d.title,
      subtitle: placed ? subtitleFor(d.title, d.labels) : null,
      spots: spots.slice(0, SPOTS_SHOWN).map((s) => s.name),
      more: Math.max(0, spots.length - SPOTS_SHOWN),
      years: yearSpan(sorted),
      posts: sorted,
      placed,
    };
  });

  // The most photographed place first; among equals, the one visited most
  // recently; the photographs that name no place at all, last.
  return groups.sort((a, b) => {
    if (a.placed !== b.placed) return a.placed ? -1 : 1;
    if (a.posts.length !== b.posts.length) return b.posts.length - a.posts.length;
    const la = when(a.posts[0]);
    const lb = when(b.posts[0]);
    if (la !== lb) return newerFirst(la, lb);
    return a.title.localeCompare(b.title);
  });
}

/** The country, when it says something the title does not; failing that, the region. */
function subtitleFor(title: string, labels: readonly PlaceLabel[]): string | null {
  const t = norm(title);
  const pick = (get: (l: PlaceLabel) => string | null): string | null => {
    const counts = new Map<string, { name: string; n: number }>();
    for (const l of labels) {
      const v = get(l);
      if (!v || norm(v) === t) continue;
      const c = counts.get(norm(v));
      if (c) c.n += 1;
      else counts.set(norm(v), { name: v, n: 1 });
    }
    const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    return best ? best.name : null;
  };
  return pick((l) => l.country) ?? pick((l) => l.region);
}

/** A line of the places list: a place's heading, or a row of its photographs. */
export type PlaceLine<T> =
  | {
      kind: "head";
      key: string;
      title: string;
      placed: boolean;
      count: number;
      /** "UNITED STATES  ·  2019–2024", or "" when there is neither. */
      meta: string;
      /** "BAR PITTI  ·  THE MET  ·  +2", or "" when no spot is named. */
      spots: string;
    }
  | {
      kind: "row";
      key: string;
      posts: T[];
      /** The place's first row, with no gap above it. */
      first: boolean;
    };

/**
 * The places as the lines of a list that draws only what is near the
 * screen, as the grid does: each place's heading, then its photographs
 * `across` to a row. Keyed by what they show, not by where they fall: a
 * heading by its place, a row by its place and its first photograph, so a
 * row the town names leave as it was keeps its key, and its squares, as
 * the names arrive.
 */
export function placeLines<T extends { id: string }>(groups: readonly PlaceGroup<T>[], across: number): PlaceLine<T>[] {
  const width = Math.max(1, Math.floor(across));
  const lines: PlaceLine<T>[] = [];
  for (const group of groups) {
    lines.push({
      kind: "head",
      key: `h|${group.key}`,
      title: group.title,
      placed: group.placed,
      count: group.posts.length,
      meta: [group.subtitle?.toUpperCase(), group.years].filter(Boolean).join("  ·  "),
      spots: group.spots.length > 0 ? group.spots.map((s) => s.toUpperCase()).join("  ·  ") + (group.more > 0 ? `  ·  +${group.more}` : "") : "",
    });
    for (let i = 0; i < group.posts.length; i += width) {
      const posts = group.posts.slice(i, i + width);
      lines.push({ kind: "row", key: `r|${group.key}|${posts[0].id}`, posts, first: i === 0 });
    }
  }
  return lines;
}

/**
 * `record` with `answers` in it: the same record when it already holds
 * every one of them, so a batch that says nothing new redraws nothing.
 */
export function withAnswers<V>(record: Readonly<Record<string, V>>, answers: ReadonlyMap<string, V>): Record<string, V> {
  let next: Record<string, V> | null = null;
  for (const [key, value] of answers) {
    if (key in record && record[key] === value) continue;
    next ??= { ...record };
    next[key] = value;
  }
  return next ?? (record as Record<string, V>);
}

/**
 * The map's answers, gathered as they come and handed on together, at
 * most once each `everyMs`, and at once when asked (`flush`, as a pass of
 * lookups ends). A town's name used to regroup and redraw every
 * photograph on the page as it arrived, and a large profile's places are
 * named one at a time over a minute or two. `stop` drops what has not
 * been handed on, as the page goes.
 */
export class AnswerBatch<V> {
  private pending = new Map<string, V>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly apply: (answers: ReadonlyMap<string, V>) => void,
    private readonly everyMs: number,
  ) {}

  add(key: string, value: V): void {
    this.pending.set(key, value);
    if (this.timer == null) this.timer = setTimeout(() => this.flush(), this.everyMs);
  }

  flush(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const answers = this.pending;
    this.pending = new Map();
    this.apply(answers);
  }

  stop(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
