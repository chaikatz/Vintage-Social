import { describe, expect, it } from "vitest";
// A plain ESM helper, shared with the seed scripts.
import { isLikelyPhotograph } from "../seed/photoFilter.mjs";

/**
 * Commons is as much a scanning project as a photo library, and the two
 * things that got through on the first pass were a Munch painting filed
 * under "Riviera" and page 11 of a 1910 trade journal that happened to
 * mention a swimming pool.
 */
describe("keeping the house photographs photographic", () => {
  const keeps = (f: string) => expect(isLikelyPhotograph(f, "")).toBe(true);
  const drops = (f: string) => expect(isLikelyPhotograph(f, "")).toBe(false);

  it("keeps ordinary photographs", () => {
    keeps("File:Positano (Italy) 02.jpg");
    keeps("File:Torii, Kyoto street - IMG 5705.JPG");
    keeps("File:Steven Zoernack and friend Ana on Lido Key, Florida.jpg");
    keeps("File:Swimming pool at the Roosevelt Hotel.jpg");
  });

  it("drops paintings and prints", () => {
    drops("File:Edvard Munch - From the Riviera.jpg");
    drops("File:Morning, Interior - Luce.jpeg");
    drops("File:A watercolour of the harbour.jpg");
    drops("File:Lithograph of a bathing machine.jpg");
  });

  it("drops scanned pages and catalogues", () => {
    drops("File:Pacific Builder and Engineer, v. 10, no. 27, Dec. 31, 1910 - DPLA - abc (page 11).jpg");
    drops("File:Sears catalogue 1963.jpg");
    drops("File:Annual report of the harbour board.jpg");
    drops("File:Title page of the almanac.jpg");
  });

  it("drops archival scan formats", () => {
    drops("File:Just Once More.tiff");
    drops("File:Something.tif");
  });

  it("reads the object title as well as the filename", () => {
    expect(isLikelyPhotograph("File:Untitled 12.jpg", "Oil on canvas")).toBe(false);
    expect(isLikelyPhotograph("File:Untitled 12.jpg", "Photograph of a pool")).toBe(true);
  });

  it("does not drop a photograph for describing itself as a print", () => {
    // Photographers say "print" about photographs constantly.
    keeps("File:Gelatin silver print of a swimmer.jpg");
    keeps("File:Portrait of a woman in Naples.jpg");
  });
});
