import { describe, expect, test } from 'bun:test';

import { encodePolyline5, staticMapUrl } from './static';

const BASE = 'https://api.rijwind.com';
const KEY = 'rw_test_abc';

describe('encodePolyline5', () => {
    test('matches the canonical Google example', () => {
        // Standard example points (lat,lng): (38.5,-120.2),(40.7,-120.95),(43.252,-126.453)
        // — passed here as [lon, lat].
        const encoded = encodePolyline5([
            [-120.2, 38.5],
            [-120.95, 40.7],
            [-126.453, 43.252],
        ]);
        expect(encoded).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    });
});

describe('staticMapUrl', () => {
    test('center + zoom + size', () => {
        const url = staticMapUrl({
            apiKey: KEY,
            center: [4.9041, 52.3676],
            zoom: 12,
            size: [800, 500],
            style: 'dark',
        });
        expect(url).toBe(`${BASE}/styles/v1/dark/static/4.9041,52.3676,12/800x500.png?key=${KEY}`);
    });

    test('hidpi + webp', () => {
        const url = staticMapUrl({ apiKey: KEY, center: [0, 0], zoom: 3, hidpi: true, format: 'webp' });
        expect(url).toContain('/static/0,0,3/512x512@2x.webp?');
    });

    test('bbox viewport (Mapbox brackets)', () => {
        const url = staticMapUrl({
            apiKey: KEY,
            bbox: [4.85, 52.34, 4.95, 52.4],
            size: [400, 300],
        });
        expect(url).toContain('/static/[4.85,52.34,4.95,52.4]/400x300.png?');
    });

    test('jpg format + multi-value padding + attribution off', () => {
        const url = staticMapUrl({
            apiKey: KEY,
            bbox: [4.85, 52.34, 4.95, 52.4],
            format: 'jpg',
            padding: [10, 20, 30, 40],
            attribution: false,
        });
        const decoded = decodeURIComponent(url);
        expect(url).toContain('.jpg?');
        expect(decoded).toContain('padding=10,20,30,40');
        expect(decoded).toContain('attribution=false');
    });

    test('auto fits overlays', () => {
        const url = staticMapUrl({
            apiKey: KEY,
            auto: true,
            size: [400, 300],
            markers: [{ lon: 4.9, lat: 52.37 }],
        });
        expect(url).toContain('/static/auto/400x300.png?');
    });

    test('bearing + pitch in the position', () => {
        const url = staticMapUrl({ apiKey: KEY, center: [1, 2], zoom: 10, bearing: 30, pitch: 45 });
        expect(url).toContain('/static/1,2,10,30,45/');
    });

    test('encodes markers, paths, and circle', () => {
        const url = staticMapUrl({
            apiKey: KEY,
            center: [4.9, 52.37],
            zoom: 11,
            markers: [{ lon: 4.9, lat: 52.37, color: '#ff0000', size: 'l', label: 'A' }],
            paths: [{ coords: [[4.9, 52.37], [4.95, 52.4]], color: '0066ff', width: 4, encoded: false }],
            circle: { radiusMeters: 2000, strokeColor: '#0066ff', fillOpacity: 0.15 },
        });
        const decoded = decodeURIComponent(url);
        expect(decoded).toContain('marker=4.9,52.37|ff0000|l|A');
        expect(decoded).toContain('path=stroke:0066ff|width:4|4.9,52.37;4.95,52.4');
        // Named circle fields — strokeWidth + fill omitted (not set).
        expect(decoded).toContain('circle=radius:2000|stroke:0066ff|fillOpacity:0.15');
    });

    test('throws without an api key', () => {
        expect(() => staticMapUrl({ center: [0, 0], zoom: 1 })).toThrow();
    });

    test('throws without center or auto', () => {
        expect(() => staticMapUrl({ apiKey: KEY, zoom: 1 })).toThrow();
    });
});
