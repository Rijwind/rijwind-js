/**
 * Tile-session helper for the Rijwind vector basemap.
 *
 * Basemap tiles are served from a CDN behind a short-lived signed URL. Rather
 * than bake that expiring URL into your MapLibre style (which breaks the map
 * once the token expires), open a *tile session*: the SDK registers a pmtiles
 * archive under a stable key and refreshes the underlying signed URL in the
 * background, so a long-open map keeps working without a restyle or flicker.
 *
 * The session also drives usage billing: the first token for a session costs
 * one unit and refreshes are free, so you're billed per map view, not per
 * tile and not per token.
 *
 * This module is a separate entry point (`@rijwind/sdk/tiles`) and uses
 * `pmtiles` types only — pass your own `pmtiles` module + `Protocol` instance
 * so the SDK never bundles or pins a map library. Import it only if you render
 * the basemap; REST-only consumers can ignore it.
 *
 * @example
 * ```ts
 * import maplibregl from "maplibre-gl";
 * import * as pmtiles from "pmtiles";
 * import { createTileSession } from "@rijwind/sdk/tiles";
 *
 * const protocol = new pmtiles.Protocol();
 * maplibregl.addProtocol("pmtiles", protocol.tile);
 *
 * const session = await createTileSession({ apiKey: "rw_live_…", pmtiles, protocol });
 *
 * const styleText = await (await fetch("https://rijwind.com/styles/light.json")).text();
 * const style = JSON.parse(styleText.replaceAll("{{TILE_URL}}", session.archiveKey));
 * const map = new maplibregl.Map({ container: "map", style });
 * // map.remove(); session.destroy();   // on teardown
 * ```
 */

import type { Protocol, RangeResponse, Source } from 'pmtiles';

/** A live tile session: a stable pmtiles archive key plus a background
 *  token-refresh loop. Reference the key in a MapLibre style via
 *  `pmtiles://${archiveKey}`; call `destroy()` when you tear the map down. */
export type TileSession = {
    archiveKey: string;
    destroy: () => void;
};

export type CreateTileSessionOptions = {
    /** Plaintext API key — `rw_live_…` or `rw_test_…`. */
    apiKey: string;
    /** Your `pmtiles` module, used for the `PMTiles` + `FetchSource`
     *  constructors. Injected so the SDK doesn't bundle or pin pmtiles. */
    pmtiles: typeof import('pmtiles');
    /** Your pmtiles `Protocol` instance — the one you've already wired into
     *  MapLibre via `maplibregl.addProtocol("pmtiles", protocol.tile)`. The
     *  session registers (and on `destroy()` unregisters) its archive on it. */
    protocol: Protocol;
    /** Override the issuer base URL. Defaults to `https://api.rijwind.com`. */
    baseUrl?: string;
    /** Custom fetch implementation. Defaults to the global `fetch`. */
    fetch?: typeof fetch;
    /** Aborts the in-flight token fetch if you tear down mid-request. */
    signal?: AbortSignal;
};

const DEFAULT_BASE_URL = 'https://api.rijwind.com';
/** Refresh at 80% of the token's lifetime, but never sooner than this floor. */
const MIN_REFRESH_MS = 15_000;
/** Retry delay after a failed refresh — the previous URL is valid until it
 *  actually expires, so a transient failure isn't fatal. */
const REFRESH_RETRY_MS = 30_000;

type TokenPayload = {
    url: string;
    // The Rust issuer emits camelCase `expiresAt`; accept snake_case too in
    // case the request is proxied through an issuer that reshapes it.
    expiresAt?: number;
    expires_at?: number;
};

async function fetchToken(
    issuerUrl: string,
    apiKey: string,
    sessionId: string,
    fetchImpl: typeof fetch,
    signal: AbortSignal | undefined,
): Promise<{ url: string; expiresAt: number | null }> {
    const sep = issuerUrl.includes('?') ? '&' : '?';
    const res = await fetchImpl(`${issuerUrl}${sep}session=${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal,
    });
    if (!res.ok) {
        throw new Error(`tiles-token returned ${res.status}`);
    }
    const payload = (await res.json()) as TokenPayload;
    const raw = payload.expiresAt ?? payload.expires_at;
    return { url: payload.url, expiresAt: typeof raw === 'number' ? raw : null };
}

/**
 * Open a tile session: fetch the first signed URL, register a pmtiles archive
 * that serves bytes from it, and keep the URL fresh in the background.
 */
export async function createTileSession(opts: CreateTileSessionOptions): Promise<TileSession> {
    const { apiKey, pmtiles, protocol, signal } = opts;
    if (!apiKey) {
        throw new Error('createTileSession: apiKey is required');
    }
    const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const fetchImpl = opts.fetch ?? fetch;
    const issuerUrl = `${baseUrl}/v1/tiles-token`;

    // One opaque session id per map instance. The archive key is derived from
    // it so concurrent maps never collide on the shared protocol. `[a-z0-9-]`
    // only, so it's safe inside the `pmtiles://<key>/{z}/{x}/{y}` request URL.
    const sessionId = crypto.randomUUID();
    const archiveKey = `rijwind-${sessionId}`;

    // The first token must be in hand before MapLibre asks the source for bytes.
    const first = await fetchToken(issuerUrl, apiKey, sessionId, fetchImpl, signal);

    // Reuse pmtiles' FetchSource for its battle-tested Range / ETag / browser-
    // cache handling, but keep a *stable* getKey() so a token refresh (which
    // changes only the query string) neither invalidates the registered archive
    // nor the cached header / directories. Refresh = mutate `inner.url`.
    const inner = new pmtiles.FetchSource(first.url);
    const source: Source = {
        getKey: () => archiveKey,
        getBytes: (offset: number, length: number, sig?: AbortSignal, etag?: string): Promise<RangeResponse> =>
            inner.getBytes(offset, length, sig, etag),
    };
    protocol.add(new pmtiles.PMTiles(source));

    let destroyed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function scheduleRefresh(expiresAt: number | null) {
        if (timer) clearTimeout(timer);
        if (destroyed || expiresAt == null) return;
        const msUntilExpiry = expiresAt * 1000 - Date.now();
        const delay = Math.max(MIN_REFRESH_MS, msUntilExpiry * 0.8);
        timer = setTimeout(() => void refresh(), delay);
    }

    async function refresh() {
        if (destroyed) return;
        try {
            const next = await fetchToken(issuerUrl, apiKey, sessionId, fetchImpl, signal);
            if (destroyed) return;
            inner.url = next.url;
            scheduleRefresh(next.expiresAt);
        } catch (err) {
            if (destroyed) return;
            console.error('tile session token refresh failed', err);
            timer = setTimeout(() => void refresh(), REFRESH_RETRY_MS);
        }
    }

    scheduleRefresh(first.expiresAt);

    return {
        archiveKey,
        destroy: () => {
            destroyed = true;
            if (timer) clearTimeout(timer);
            protocol.tiles.delete(archiveKey);
        },
    };
}
