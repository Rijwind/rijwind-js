/**
 * Global SDK configuration.
 *
 * Set your key once and every `Map`, `createClient`, and tile session picks
 * it up:
 *
 * ```ts
 * import { config } from "@rijwind/sdk";
 * config.apiKey = "rw_live_…";
 * ```
 *
 * Per-call options (e.g. `new Map({ apiKey })` or `createClient({ apiKey })`)
 * override whatever is set here.
 */
export type RijwindConfig = {
    /** Plaintext API key — `rw_live_…` or `rw_test_…`. */
    apiKey: string;
    /** API base URL. Defaults to production. Point at a local instance in dev. */
    baseUrl: string;
    /** Custom fetch implementation. Defaults to the global `fetch`. */
    fetch?: typeof fetch;
};

export const config: RijwindConfig = {
    apiKey: '',
    baseUrl: 'https://api.rijwind.com',
};
