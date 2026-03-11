'use strict';
/**
 * Node.js SEA bootstrap (CommonJS).
 *
 * Node.js SEA only allows a CommonJS main script, but our app is ESM + TLA.
 * We bridge this by:
 *   1. Registering a custom module-loader hook (via a data-URL ESM module)
 *      that intercepts import(APP_URL) and serves the bundled ESM from the
 *      embedded SEA asset.
 *   2. Dispatching import(APP_URL) to launch the app.
 *
 * The APP_URL is derived from the exe's own directory so that import.meta.url
 * inside the ESM bundle resolves to a real directory — needed for .env lookup.
 */

const { register } = require('node:module');
const path         = require('node:path');
const { pathToFileURL } = require('node:url');

// Virtual file URL for the app module.  We use the exe directory so that
// import.meta.url in the bundle == a real directory (for .env discovery).
const APP_URL = pathToFileURL(
  path.join(path.dirname(process.execPath), '__fella_sea__.mjs'),
).href;

// ESM hooks module (served as a data URL so no on-disk file is needed).
// The load hook reads the bundled source from the SEA asset.
const HOOK = /* js */ `
export function resolve(specifier, ctx, next) {
  if (specifier === ${JSON.stringify(APP_URL)}) {
    return { shortCircuit: true, url: specifier, format: 'module' };
  }
  return next(specifier, ctx);
}

export async function load(url, ctx, next) {
  if (url === ${JSON.stringify(APP_URL)}) {
    const { getAsset } = await import('node:sea');
    const source = getAsset('app', 'utf8');
    return { shortCircuit: true, format: 'module', source };
  }
  return next(url, ctx);
}
`;

register(
  'data:text/javascript,' + encodeURIComponent(HOOK),
  pathToFileURL(__filename).href,
);

// Boot the app.  The async IIFE gives the hooks worker time to start before
// the first import() is dispatched.
(async () => {
  await import(APP_URL);
})();
