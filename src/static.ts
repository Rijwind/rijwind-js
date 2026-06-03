/**
 * Build a static-map image URL — drop the result straight into an `<img src>`.
 *
 * Pure string building: no network, no map library. Safe in Node or the browser.
 *
 * ```ts
 * import { staticMapUrl, config } from "@rijwind/sdk";
 * config.apiKey = "rw_live_…";
 *
 * const url = staticMapUrl({
 *   center: [4.9041, 52.3676],
 *   zoom: 12,
 *   size: [800, 500],
 *   style: "light",
 *   markers: [{ lon: 4.9041, lat: 52.3676, color: "#ff0000", size: "l" }],
 *   circle: { radiusMeters: 1000 },
 * });
 * // <img src={url} width={800} height={500} />
 * ```
 */

import { config } from './config';

export type StaticMapStyle = 'light' | 'dark' | 'grayscale' | 'white' | 'black';
export type StaticMapFormat = 'png' | 'webp' | 'jpg';
export type MarkerSize = 's' | 'm' | 'l';
export type StaticAttribution = 'bottomright' | 'bottomleft' | 'topleft' | 'topright';

export interface StaticMarker {
    /** `[lon, lat]` — or pass `lon`/`lat` separately. */
    lon: number;
    lat: number;
    /** Hex color, with or without a leading `#`. */
    color?: string;
    size?: MarkerSize;
    label?: string;
}

export interface StaticPath {
    /** Ordered `[lon, lat]` vertices. */
    coords: Array<[number, number]>;
    color?: string;
    width?: number;
    opacity?: number;
    /** Fill color for a closed path. */
    fill?: string;
    fillOpacity?: number;
    /** Encode the geometry as a polyline for a shorter URL (default `true`). */
    encoded?: boolean;
}

export interface StaticCircle {
    radiusMeters: number;
    strokeColor?: string;
    strokeWidth?: number;
    fillColor?: string;
    fillOpacity?: number;
}

export interface StaticMapParams {
    style?: StaticMapStyle;
    /** `[lon, lat]`. Required unless `bbox` or `auto` is set. */
    center?: [number, number];
    /** Zoom level. Pair with `center`; omit to use `bbox` or `auto`. */
    zoom?: number;
    /** `[minLon, minLat, maxLon, maxLat]` — frame this box (instead of center+zoom). */
    bbox?: [number, number, number, number];
    /** Frame the overlays automatically (instead of center+zoom). */
    auto?: boolean;
    /** `[width, height]` in CSS px — or pass `width`/`height`. Default `[512, 512]`. */
    size?: [number, number];
    width?: number;
    height?: number;
    /** Render at 2× pixel density (`@2x`, for High-DPI screens). Costs 2 quota units. */
    hidpi?: boolean;
    format?: StaticMapFormat;
    bearing?: number;
    pitch?: number;
    /** Inner padding (px) when fitting a `bbox`/`auto` — one value (all sides) or
     *  1–4 CSS-order values `[top, right, bottom, left]`. */
    padding?: number | number[];
    /** Attribution corner, or `false` to omit it (then credit OpenStreetMap elsewhere). */
    attribution?: StaticAttribution | false;
    markers?: StaticMarker[];
    paths?: StaticPath[];
    circle?: StaticCircle;
    /** API key. Defaults to `config.apiKey`. */
    apiKey?: string;
    /** API base URL. Defaults to `config.baseUrl`. */
    baseUrl?: string;
}

function hex(color: string | undefined): string {
    return color ? color.replace(/^#/, '') : '';
}

/** Join positional pipe-fields, dropping a run of trailing empties. */
function pipe(fields: Array<string | number | undefined>): string {
    const parts = fields.map((f) => (f === undefined ? '' : String(f)));
    while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    return parts.join('|');
}

/** Join `key:value` fields, dropping any whose value is undefined/empty. */
function named(fields: Array<[string, string | number | undefined]>): string[] {
    return fields
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}:${v}`);
}

/** Encode `[lon, lat]` pairs as a Google polyline (precision 5). */
export function encodePolyline5(coords: Array<[number, number]>): string {
    let lastLat = 0;
    let lastLng = 0;
    let out = '';
    const chunk = (value: number): string => {
        let v = value < 0 ? ~(value << 1) : value << 1;
        let s = '';
        while (v >= 0x20) {
            s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
            v >>= 5;
        }
        s += String.fromCharCode(v + 63);
        return s;
    };
    for (const [lon, lat] of coords) {
        const latE5 = Math.round(lat * 1e5);
        const lngE5 = Math.round(lon * 1e5);
        out += chunk(latE5 - lastLat) + chunk(lngE5 - lastLng);
        lastLat = latE5;
        lastLng = lngE5;
    }
    return out;
}

function marker(m: StaticMarker): string {
    return pipe([`${m.lon},${m.lat}`, hex(m.color), m.size, m.label]);
}

function path(p: StaticPath): string {
    const geom =
        p.encoded === false
            ? p.coords.map(([lon, lat]) => `${lon},${lat}`).join(';')
            : `enc:${encodePolyline5(p.coords)}`;
    const style = named([
        ['stroke', hex(p.color) || undefined],
        ['width', p.width],
        ['opacity', p.opacity],
        ['fill', hex(p.fill) || undefined],
        ['fillOpacity', p.fillOpacity],
    ]);
    return [...style, geom].join('|');
}

function circle(c: StaticCircle): string {
    return named([
        ['radius', c.radiusMeters],
        ['stroke', hex(c.strokeColor) || undefined],
        ['strokeWidth', c.strokeWidth],
        ['fill', hex(c.fillColor) || undefined],
        ['fillOpacity', c.fillOpacity],
    ]).join('|');
}

export function staticMapUrl(params: StaticMapParams): string {
    const apiKey = params.apiKey ?? config.apiKey;
    if (!apiKey) {
        throw new Error('staticMapUrl: set config.apiKey or pass apiKey in params');
    }
    const baseUrl = (params.baseUrl ?? config.baseUrl).replace(/\/$/, '');
    const style = params.style ?? 'light';

    // position segment
    let position: string;
    if (params.auto) {
        position = 'auto';
    } else if (params.bbox) {
        position = `[${params.bbox.join(',')}]`;
    } else if (params.center && params.zoom != null) {
        const [lon, lat] = params.center;
        const segs: Array<number> = [lon, lat, params.zoom];
        if (params.bearing != null || params.pitch != null) segs.push(params.bearing ?? 0);
        if (params.pitch != null) segs.push(params.pitch);
        position = segs.join(',');
    } else {
        throw new Error('staticMapUrl: provide center+zoom, a bbox, or auto');
    }

    // size segment
    const width = params.size?.[0] ?? params.width ?? 512;
    const height = params.size?.[1] ?? params.height ?? 512;
    const format = params.format ?? 'png';
    const size = `${width}x${height}${params.hidpi ? '@2x' : ''}.${format}`;

    // query
    const q = new URLSearchParams();
    if (params.padding != null) {
        q.set('padding', Array.isArray(params.padding) ? params.padding.join(',') : String(params.padding));
    }
    if (params.attribution !== undefined) {
        q.set('attribution', params.attribution === false ? 'false' : params.attribution);
    }
    for (const m of params.markers ?? []) q.append('marker', marker(m));
    for (const p of params.paths ?? []) q.append('path', path(p));
    if (params.circle) q.set('circle', circle(params.circle));
    q.set('key', apiKey);

    // The bbox position carries literal `[ ]`; URLSearchParams only touches the
    // query, so the brackets ride through to the path exactly as Mapbox expects.
    return `${baseUrl}/styles/v1/${style}/static/${position}/${size}?${q.toString()}`;
}
