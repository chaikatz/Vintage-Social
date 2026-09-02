/**
 * Is this Commons file actually a photograph someone took?
 *
 * Commons is as much a scanning project as a photo library. Searching it for
 * "swimming pool 1970s" returns swimming pools, and also: paintings of
 * swimming pools, the title page of a 1910 trade journal that mentions one,
 * and a museum's catalogue plate. All three are public domain, none of them
 * belongs in a photography club's feed.
 *
 * Two families to keep out, and they need different tests:
 *
 *   * Artwork — paintings, prints, engravings. Usually named "Painter -
 *     Title", and usually says so in the file's own title for the object.
 *   * Scans — book pages, journals, catalogues, microfilm. These give
 *     themselves away in the filename: a page number, a volume and issue,
 *     or the name of the bulk-digitisation programme that produced them.
 *
 * Both tests read the filename and the object title only, never the
 * free-text description: photographers write "print", "plate" and "portrait"
 * about photographs constantly, and matching on the description threw away
 * more real photography than junk.
 */

const ARTWORK =
  /(painting|drawing|engraving|etching|lithograph|woodcut|watercolou?r|oil on canvas|fresco|tapestry|sculpture|coat of arms|map of|manuscript|banknote)/i;

/**
 * The museum naming convention, which runs both ways: "Edvard Munch - From
 * the Riviera" and "Morning, Interior - Luce". What separates it from a
 * photograph that happens to contain a dash is what follows the dash — a
 * catalogue entry ends in words, a photograph ends in a camera's filename
 * or a number ("Kyoto street - IMG 5705", "Harbour - 02").
 *
 * This is deliberately eager. Losing the occasional real photograph named
 * "Beach - Naples" costs nothing when there are thousands to choose from;
 * one painting in a photography club's feed is immediately wrong.
 */
const MUSEUM_TITLE = /\s-\s[A-Z][a-zà-ÿ]+(\s+[A-Za-zà-ÿ]+){0,2}\.[a-z]+$/;

const SCAN =
  /(\bDPLA\b|\(page \d|\bpage \d+\b|\bv\.\s?\d+,?\s?no\.\s?\d+|\bvol\.\s?\d+|\bno\.\s?\d+,\s|title page|front cover|back cover|catalogue|catalog of|bulletin|annual report|almanac|gazette|newspaper|periodical|microfilm|\bplate [ivxlc\d]+\b|letterhead|postcard of|sheet music|advertisement|poster for|\bmap\b|\bchart\b|\bdiagram\b|\bindex\b)/i;

/** Archival scans are overwhelmingly TIFF; photographs are not. */
const SCAN_FORMAT = /\.(tiff?|djvu|pdf)$/i;

export function isLikelyPhotograph(file, objectName = "") {
  const named = `${file} ${objectName}`;
  if (ARTWORK.test(named)) return false;
  if (MUSEUM_TITLE.test(file)) return false;
  if (SCAN.test(named)) return false;
  if (SCAN_FORMAT.test(file)) return false;
  return true;
}
