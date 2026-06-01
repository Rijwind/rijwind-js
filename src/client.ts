/**
 * Headless REST client for the Rijwind API — geocoding, routing, matrix,
 * isochrone, and the low-level tile-token signer. No map renderer, safe to
 * use in Node or any backend.
 *
 * This is the light entry point: `import { createClient } from "@rijwind/sdk/client"`.
 * It pulls in no map library. The main `@rijwind/sdk` entry re-exports
 * everything here too, plus the browser `Map`.
 *
 * Types in `./types.ts` are generated from `apps/docs/apis/openapi.json`
 * (itself generated from the Rust API's `#[utoipa::path]` annotations).
 * Regenerate with `npm run gen-types`.
 */

import createOpenApiClient from 'openapi-fetch';

import { config } from './config';
import type { paths } from './types';

export type RijwindClientOptions = {
    /** Plaintext API key. Defaults to `config.apiKey`. */
    apiKey?: string;
    /** Override the base URL. Defaults to `config.baseUrl` (production). */
    baseUrl?: string;
    /** Custom fetch implementation. Defaults to `config.fetch` or the global `fetch`. */
    fetch?: typeof fetch;
};

// Query and body types — derived from the OpenAPI spec so they stay in
// sync as the API evolves. Re-export them so consumers can type their
// own helper functions without depending on openapi-fetch directly.
export type GeocodeSearchParams = NonNullable<paths['/v1/geocode/search']['get']['parameters']['query']>;
export type GeocodeAutocompleteParams = NonNullable<paths['/v1/geocode/autocomplete']['get']['parameters']['query']>;
export type GeocodeReverseParams = NonNullable<paths['/v1/geocode/reverse']['get']['parameters']['query']>;
export type RouteRequest = NonNullable<paths['/v1/route']['post']['requestBody']>['content']['application/json'];
export type MatrixRequest = NonNullable<paths['/v1/matrix']['post']['requestBody']>['content']['application/json'];
export type IsochroneRequest = NonNullable<paths['/v1/isochrone']['post']['requestBody']>['content']['application/json'];

export type SignedTileUrl = paths['/v1/tiles-token']['get']['responses'][200]['content']['application/json'];
export type PlaceFeatureCollection = paths['/v1/geocode/search']['get']['responses'][200]['content']['application/json'];
export type RouteResponse = paths['/v1/route']['post']['responses'][200]['content']['application/json'];
export type MatrixResponse = paths['/v1/matrix']['post']['responses'][200]['content']['application/json'];
export type IsochroneResponse = paths['/v1/isochrone']['post']['responses'][200]['content']['application/json'];

export function createClient(options: RijwindClientOptions = {}) {
    const apiKey = options.apiKey ?? config.apiKey;
    if (!apiKey) {
        throw new Error('createClient: set config.apiKey or pass apiKey in options');
    }

    const client = createOpenApiClient<paths>({
        baseUrl: options.baseUrl ?? config.baseUrl,
        fetch: options.fetch ?? config.fetch,
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    return {
        /** Underlying openapi-fetch client, for endpoints not wrapped below. */
        raw: client,

        tiles: {
            /**
             * Sign a single short-lived URL for the basemap. Low-level
             * primitive — to render a map, use the `Map` class from the main
             * `@rijwind/sdk` entry, which opens and refreshes a tile session
             * for you.
             */
            async token() {
                return client.GET('/v1/tiles-token');
            },
        },

        geocode: {
            /** Forward geocode — turn a place name or address into coordinates. */
            async search(params: GeocodeSearchParams) {
                return client.GET('/v1/geocode/search', { params: { query: params } });
            },
            /** Type-ahead variant, billed at 0.1 unit per call. */
            async autocomplete(params: GeocodeAutocompleteParams) {
                return client.GET('/v1/geocode/autocomplete', { params: { query: params } });
            },
            /** Reverse geocode — coordinates to the nearest named place. */
            async reverse(params: GeocodeReverseParams) {
                return client.GET('/v1/geocode/reverse', { params: { query: params } });
            },
        },

        /** Turn-by-turn directions between two or more waypoints. */
        async route(body: RouteRequest) {
            return client.POST('/v1/route', { body });
        },

        /** Travel-time matrix. Capped at `M × N ≤ 2500`. */
        async matrix(body: MatrixRequest) {
            return client.POST('/v1/matrix', { body });
        },

        /** Reachable-area polygons. Capped at `L × C ≤ 4`. */
        async isochrone(body: IsochroneRequest) {
            return client.POST('/v1/isochrone', { body });
        },
    };
}

export type RijwindClient = ReturnType<typeof createClient>;
