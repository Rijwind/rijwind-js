/**
 * `Map` — a drop-in MapLibre map wired to the Rijwind basemap.
 *
 * Extends `maplibre-gl`'s `Map`, so every MapLibre method, event, and option
 * works unchanged. On top, it:
 *   - registers the pmtiles protocol (once, process-wide),
 *   - opens a billed tile session and keeps its signed URL fresh in the
 *     background (one unit per map view; refreshes are free),
 *   - loads one of the ready-made themes (or your own style),
 * all from a single `apiKey`. You never touch signed URLs, sessions, or the
 * pmtiles wiring.
 *
 * ```ts
 * import { Map, MapStyle, config } from "@rijwind/sdk";
 * import "@rijwind/sdk/style.css";
 *
 * config.apiKey = "rw_live_…";
 * const map = new Map({ container: "map", style: MapStyle.LIGHT, center: [4.9, 52.37], zoom: 10 });
 * ```
 */
import { Map as MaplibreMap, addProtocol, type MapOptions as MlMapOptions } from 'maplibre-gl';
import { FetchSource, PMTiles, Protocol, type RangeResponse, type Source } from 'pmtiles';

import { config } from './config';
import { BOOTSTRAP_STYLE, MapStyle, resolveStyle, type StyleInput } from './style';

/** Refresh at 80% of the token's lifetime, but never sooner than this floor. */
const MIN_REFRESH_MS = 15_000;
/** Retry delay after a failed refresh — the live URL is valid until it
 *  actually expires, so a transient failure isn't fatal. */
const REFRESH_RETRY_MS = 30_000;

// MapLibre's pmtiles protocol handler is a process-global singleton:
// `addProtocol` must run exactly once. Register lazily, reuse the instance.
let sharedProtocol: Protocol | null = null;
function ensureProtocol(): Protocol {
    if (!sharedProtocol) {
        sharedProtocol = new Protocol();
        addProtocol('pmtiles', sharedProtocol.tile);
    }
    return sharedProtocol;
}

type TokenPayload = { url: string; expiresAt?: number; expires_at?: number };

type ManagedSession = { archiveKey: string; destroy: () => void };

/**
 * Register a pmtiles archive whose signed URL is fetched lazily (on the first
 * byte request) and refreshed in the background. Lazy so the `Map`
 * constructor stays synchronous and a map that never renders never spends a
 * unit. Mirrors `apps/web/src/lib/tile-session.ts`, but uses the bundled
 * pmtiles and authenticates with the API key.
 */
function openSession(apiKey: string, protocol: Protocol): ManagedSession {
    const issuerUrl = `${config.baseUrl.replace(/\/$/, '')}/tiles/v1/token`;
    const fetchImpl = config.fetch ?? fetch;
    const sessionId = crypto.randomUUID();
    const archiveKey = `rijwind-${sessionId}`;

    let inner: FetchSource | null = null;
    let firstTokenPromise: Promise<void> | null = null;
    let destroyed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function fetchToken(): Promise<{ url: string; expiresAt: number | null }> {
        const sep = issuerUrl.includes('?') ? '&' : '?';
        const res = await fetchImpl(`${issuerUrl}${sep}session=${encodeURIComponent(sessionId)}`, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        });
        if (!res.ok) {
            throw new Error(`tiles-token returned ${res.status}`);
        }
        const payload = (await res.json()) as TokenPayload;
        const raw = payload.expiresAt ?? payload.expires_at;
        return { url: payload.url, expiresAt: typeof raw === 'number' ? raw : null };
    }

    function scheduleRefresh(expiresAt: number | null) {
        if (timer) clearTimeout(timer);
        if (destroyed || expiresAt == null) return;
        const msUntilExpiry = expiresAt * 1000 - Date.now();
        timer = setTimeout(() => void refresh(), Math.max(MIN_REFRESH_MS, msUntilExpiry * 0.8));
    }

    async function refresh() {
        if (destroyed) return;
        try {
            const next = await fetchToken();
            if (destroyed) return;
            if (inner) inner.url = next.url;
            scheduleRefresh(next.expiresAt);
        } catch (err) {
            if (destroyed) return;
            console.error('rijwind: tile token refresh failed', err);
            timer = setTimeout(() => void refresh(), REFRESH_RETRY_MS);
        }
    }

    async function ensureToken(): Promise<void> {
        if (inner) return;
        if (!firstTokenPromise) {
            firstTokenPromise = (async () => {
                const first = await fetchToken();
                inner = new FetchSource(first.url);
                scheduleRefresh(first.expiresAt);
            })();
        }
        await firstTokenPromise;
    }

    const source: Source = {
        getKey: () => archiveKey,
        getBytes: async (
            offset: number,
            length: number,
            signal?: AbortSignal,
            etag?: string,
        ): Promise<RangeResponse> => {
            await ensureToken();
            return inner!.getBytes(offset, length, signal, etag);
        },
    };
    protocol.add(new PMTiles(source));

    return {
        archiveKey,
        destroy: () => {
            destroyed = true;
            if (timer) clearTimeout(timer);
            protocol.tiles.delete(archiveKey);
        },
    };
}

export type RijwindMapOptions = Omit<MlMapOptions, 'style'> & {
    /** A ready-made `MapStyle`, your own style URL, or a style object.
     *  Defaults to `MapStyle.LIGHT`. */
    style?: StyleInput;
    /** API key for this map. Defaults to `config.apiKey`. */
    apiKey?: string;
};

export class Map extends MaplibreMap {
    #session: ManagedSession;

    constructor(options: RijwindMapOptions) {
        const apiKey = options.apiKey ?? config.apiKey;
        if (!apiKey) {
            throw new Error('Rijwind Map: set config.apiKey or pass apiKey in options');
        }

        const protocol = ensureProtocol();
        const session = openSession(apiKey, protocol);

        // Boot synchronously with an empty style, then swap in the real one
        // once its JSON is fetched and the archive key is substituted.
        const { apiKey: _apiKey, style: styleInput, ...mapOptions } = options;
        super({ ...mapOptions, style: BOOTSTRAP_STYLE });

        this.#session = session;

        void this.#applyStyle(styleInput ?? MapStyle.LIGHT);
    }

    /** Tears down the map and its tile session (refresh timer + archive). */
    override remove(): void {
        this.#session.destroy();
        super.remove();
    }

    async #applyStyle(style: StyleInput): Promise<void> {
        try {
            const resolved = await resolveStyle(style, this.#session.archiveKey, config.fetch ?? fetch);
            // The map may have been removed while the style was loading;
            // maplibre marks `_removed` true after `.remove()`.
            if ((this as unknown as { _removed?: boolean })._removed === true) return;
            this.setStyle(resolved);
        } catch (err) {
            console.error('rijwind: failed to load basemap style', err);
        }
    }
}
