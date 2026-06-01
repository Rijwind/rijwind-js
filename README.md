# @rijwind/sdk

Maps, geocoding, and routing for the open web — one key, fully typed.

```sh
npm install @rijwind/sdk
```

## Show a map

```ts
import { Map, MapStyle, config } from '@rijwind/sdk';
import '@rijwind/sdk/style.css';

config.apiKey = 'rw_live_…';

const map = new Map({
    container: 'map',
    style: MapStyle.LIGHT, // LIGHT · DARK · GRAYSCALE · WHITE · BLACK
    center: [4.9041, 52.3676],
    zoom: 10,
});
```

`Map` extends [MapLibre GL JS](https://maplibre.org/), so every MapLibre
method, event, and option works unchanged — markers, popups, layers, the
lot. On top, it opens a basemap **tile session** and keeps it fresh in the
background, so a long-open map keeps working and you're billed once per map
view, not per tile. You never handle signed URLs or tokens.

Tear-down is just MapLibre's `remove()` — the tile session is cleaned up
with it:

```ts
map.remove();
```

### Custom styles

Pass your own MapLibre style URL or object instead of a `MapStyle`. Anywhere
the tile source should point at the basemap, use the `{{TILE_URL}}`
placeholder — the SDK substitutes the live session for you:

```ts
const map = new Map({ container: 'map', style: 'https://example.com/my-style.json' });
```

## Geocoding & routing

The same package exposes a typed REST client. In Node or any backend, import
it from the light entry point (`@rijwind/sdk/client`) so no map library is
pulled in:

```ts
import { createClient } from '@rijwind/sdk/client';

const rijwind = createClient({ apiKey: process.env.RIJWIND_API_KEY! });

// Forward geocode
const { data, error } = await rijwind.geocode.search({ q: 'Damrak 1, Amsterdam', limit: 5 });
if (!error) {
    for (const f of data.features) console.log(f.properties.name, f.geometry.coordinates);
}
```

In the browser you can use the same methods straight off the main entry:

```ts
import { createClient, config } from '@rijwind/sdk';
config.apiKey = 'rw_live_…';
const rijwind = createClient(); // picks up config.apiKey
```

Every method returns `{ data, error, response }` — the same shape as
[openapi-fetch](https://openapi-ts.dev/openapi-fetch/), which this wraps.
`data` is typed against the success response; `error` against the error
envelope.

### Route

```ts
const { data } = await rijwind.route({
    locations: [
        { lat: 52.3676, lon: 4.9041 },
        { lat: 52.0907, lon: 5.1214 },
    ],
    costing: 'bicycle',
});

console.log(data?.trip.summary);        // { length, time, ... }
console.log(data?.trip.legs[0].shape);  // encoded polyline (1e-6 precision)
```

### Isochrone

```ts
const { data } = await rijwind.isochrone({
    locations: [{ lat: 52.3676, lon: 4.9041 }],
    costing: 'bicycle',
    contours: [{ time: 5 }, { time: 10 }, { time: 15 }],
    polygons: true,
});
```

## Configuration

`config` holds the defaults every `Map` and `createClient` falls back to:

```ts
import { config } from '@rijwind/sdk';

config.apiKey = 'rw_live_…';
config.baseUrl = 'https://api.rijwind.com'; // default; point at a local instance in dev
config.fetch = customFetch;                 // optional — inject retries, telemetry
```

Per-call options override the globals: `new Map({ apiKey })`,
`createClient({ apiKey, baseUrl })`.

## Entry points

| Import | Contains | Pulls in MapLibre? |
| --- | --- | --- |
| `@rijwind/sdk` | `Map`, `MapStyle`, `config`, REST client + types | yes (browser) |
| `@rijwind/sdk/client` | REST client + types only | no (Node-safe) |
| `@rijwind/sdk/style.css` | map stylesheet | — |

## Errors

Every endpoint returns the same envelope on failure:

```ts
{
    error: 'quota_exhausted',                   // stable, machine-readable
    message: 'Monthly request quota exceeded.', // for humans
}
```

Common codes: `missing_key`, `invalid_key`, `revoked_key`,
`origin_blocked`, `quota_exhausted`, `matrix_too_large`,
`isochrone_too_large`. See [the error reference](https://docs.rijwind.com/errors).

## Raw client

Need an endpoint that isn't wrapped? Drop down to the underlying
openapi-fetch client — it speaks the full OpenAPI surface:

```ts
const { data } = await rijwind.raw.GET('/v1/tiles-token');
```

## Versioning

`@rijwind/sdk` follows the API: `0.x.y` while in preview, `1.x.y` once the
API has been stable for a quarter. Breaking changes ship in a major;
additive endpoints and optional parameters in minors.

## License

MIT.
