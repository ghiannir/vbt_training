// @ts-check
// Entry point: wires ble.js, session.js, storage.js, lvprofile.js and ui.js together.
// Also registers the optional service worker (WA-71) and handles ?demo=1 (WA-81).

/** Called once on DOMContentLoaded. */
export async function main() {
  throw new Error("not implemented");
}

/** Optional: register sw.js; failures must not block the app. */
export async function registerServiceWorker() {
  throw new Error("not implemented");
}
