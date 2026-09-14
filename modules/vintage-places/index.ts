/**
 * The native side of the place picker — see `src/api/places.ts` for the JS
 * entry point, which loads this module optionally so the browser build
 * and a binary without it fall back to typing a place by hand.
 */
export interface NativePlace {
  /** Provider identifier: Apple's where the OS offers one, else a stable derived key. */
  id: string;
  name: string;
  /** Enough address to tell two places of the same name apart. */
  subtitle: string;
  lat: number;
  lng: number;
  /** Apple's category, e.g. "MKPOICategoryRestaurant", when known. */
  category: string | null;
}

export interface VintagePlacesModule {
  search(query: string): Promise<NativePlace[]>;
}
