/**
 * Bundled demo photographs.
 *
 * Isolated from the rest of the demo module because Metro resolves these
 * require() calls at build time; node-side tests never need to load them.
 */

/** seed -> bundled asset. Metro resolves each require() at build time. */
export const PHOTOS: Record<string, number> = {
  "athens-cats": require("../../assets/demo/athens-cats.jpg"),
  "athens-ferry": require("../../assets/demo/athens-ferry.jpg"),
  "athens-october": require("../../assets/demo/athens-october.jpg"),
  "cdmx-market": require("../../assets/demo/cdmx-market.jpg"),
  "cdmx-plaza": require("../../assets/demo/cdmx-plaza.jpg"),
  "cdmx-wall": require("../../assets/demo/cdmx-wall.jpg"),
  "kyoto-breakfast": require("../../assets/demo/kyoto-breakfast.jpg"),
  "kyoto-moss": require("../../assets/demo/kyoto-moss.jpg"),
  "kyoto-train": require("../../assets/demo/kyoto-train.jpg"),
  "kyoto-video": require("../../assets/demo/kyoto-video.jpg"),
  "lagos-rain": require("../../assets/demo/lagos-rain.jpg"),
  "lagos-street": require("../../assets/demo/lagos-street.jpg"),
  "lagos-tailor": require("../../assets/demo/lagos-tailor.jpg"),
  "lisboa-praia": require("../../assets/demo/lisboa-praia.jpg"),
  "lisboa-tiles": require("../../assets/demo/lisboa-tiles.jpg"),
  "lisboa-tram": require("../../assets/demo/lisboa-tram.jpg"),
  "lyon-market": require("../../assets/demo/lyon-market.jpg"),
  "lyon-traboule": require("../../assets/demo/lyon-traboule.jpg"),
  "milan-cortile": require("../../assets/demo/milan-cortile.jpg"),
  "milan-mercato": require("../../assets/demo/milan-mercato.jpg"),
  "milan-nebbia": require("../../assets/demo/milan-nebbia.jpg"),
  "milan-tram": require("../../assets/demo/milan-tram.jpg"),
  "nola-brass": require("../../assets/demo/nola-brass.jpg"),
  "nola-porch": require("../../assets/demo/nola-porch.jpg"),
  "nola-video": require("../../assets/demo/nola-video.jpg"),
  "paris-cafe": require("../../assets/demo/paris-cafe.jpg"),
  "paris-seine": require("../../assets/demo/paris-seine.jpg"),
  "paris-stone": require("../../assets/demo/paris-stone.jpg"),
  "sthlm-cabin": require("../../assets/demo/sthlm-cabin.jpg"),
  "sthlm-ferry": require("../../assets/demo/sthlm-ferry.jpg"),
  "sthlm-ice": require("../../assets/demo/sthlm-ice.jpg"),
};
