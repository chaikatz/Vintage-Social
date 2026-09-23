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
    const sorted = [...d.posts].sort((a, b) => when(b).localeCompare(when(a)));
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
    if (la !== lb) return lb.localeCompare(la);
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
