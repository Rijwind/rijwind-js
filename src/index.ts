/**
 * `@rijwind/sdk` — maps, geocoding, and routing for the open web.
 *
 * This is the browser entry point: it includes the `Map` renderer (which
 * bundles MapLibre + pmtiles). For Node or any headless/backend use, import
 * the light REST client instead:
 *
 *   ```ts
 *   import { createClient } from "@rijwind/sdk/client";
 *   ```
 *
 * which pulls in no map library.
 */

// Browser map renderer.
export { Map, type RijwindMapOptions } from './map';
export { MapStyle, type MapStyleValue, type StyleInput } from './style';

// Shared config (apiKey, baseUrl, fetch).
export { config, type RijwindConfig } from './config';

// REST surface + generated types (also available standalone via /client).
export * from './client';
