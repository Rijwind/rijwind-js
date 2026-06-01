/**
 * Ready-made basemap styles and style loading.
 *
 * `MapStyle` values are plain URLs, so referencing one pulls in no map
 * library — only the `Map` class does. Pass a `MapStyle`, your own style
 * URL, or a full MapLibre style object to `new Map({ style })`.
 */
import type { StyleSpecification } from 'maplibre-gl';

const STYLE_HOST = 'https://rijwind.com/styles';

/** The five hosted basemap themes. */
export const MapStyle = {
    LIGHT: `${STYLE_HOST}/light.json`,
    DARK: `${STYLE_HOST}/dark.json`,
    GRAYSCALE: `${STYLE_HOST}/grayscale.json`,
    WHITE: `${STYLE_HOST}/white.json`,
    BLACK: `${STYLE_HOST}/black.json`,
} as const;

export type MapStyleValue = (typeof MapStyle)[keyof typeof MapStyle];

/** A style passed to `new Map`: a hosted theme, any style URL, or an object. */
export type StyleInput = MapStyleValue | (string & {}) | StyleSpecification;

/**
 * Resolve a `StyleInput` to a concrete MapLibre style object with the tile
 * source pointed at the session's archive key. A string is fetched and
 * `{{TILE_URL}}`-substituted; an object is substituted in place.
 */
export async function resolveStyle(
    style: StyleInput,
    archiveKey: string,
    fetchImpl: typeof fetch,
): Promise<StyleSpecification> {
    if (typeof style === 'string') {
        const res = await fetchImpl(style);
        if (!res.ok) {
            throw new Error(`failed to load style ${style}: ${res.status}`);
        }
        const text = (await res.text()).replaceAll('{{TILE_URL}}', archiveKey);
        return JSON.parse(text) as StyleSpecification;
    }
    const text = JSON.stringify(style).replaceAll('{{TILE_URL}}', archiveKey);
    return JSON.parse(text) as StyleSpecification;
}

/** Minimal valid style used to boot the map before the real style loads. */
export const BOOTSTRAP_STYLE: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [],
};
