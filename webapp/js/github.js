// @ts-check
// "GitHub sync": after every set the whole current session is uploaded as one
// JSON file to a private repo through the GitHub Contents API. Fire-and-forget: the
// live workout UI never waits for it. Failed uploads stay in an outbox (session ids
// only; the data lives in IndexedDB) and are retried later.
// Pure helpers are exported on their own; the uploader takes `fetch` and storage as
// dependencies so it can be tested in Node.

import { buildBackup } from "./storage.js";

/** @typedef {import("./session.js").Session} Session */

export const DEFAULT_REPO = "ghiannir/vbt-data";
export const OUTBOX_KEY = "vbt.github.outbox";
export const SHAS_KEY = "vbt.github.shas";
export const LAST_KEY = "vbt.github.last";
const API = "https://api.github.com";

/** @param {number} n */
const pad = (n) => String(n).padStart(2, "0");

/**
 * Local date as YYYY-MM-DD.
 * @param {number} ms
 */
export function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `sessions/YYYY/MM/<YYYY-MM-DD_HHMMSS>_<sessionId>.json`, local time of session start.
 * @param {{ id: string, startedAt: number }} session
 * @returns {string}
 */
export function sessionPath(session) {
  const d = new Date(session.startedAt);
  const date = localDate(session.startedAt);
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const safeId = String(session.id).replace(/[^A-Za-z0-9._-]/g, "_");
  return `sessions/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${date}_${time}_${safeId}.json`;
}

/**
 * @param {{ startedAt: number, sets: unknown[] }} session
 * @returns {string}
 */
export function commitMessage(session) {
  return `Session ${localDate(session.startedAt)} – set ${session.sets.length}`;
}

/**
 * Base64 of the UTF-8 bytes of a string (btoa alone breaks on non-ASCII).
 * @param {string} text
 * @returns {string}
 */
export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * File content for a session: the same shape as the JSON backup (without settings, so
 * the token can never leak), pretty-printed.
 * @param {Session} session
 * @param {number} [now]
 * @returns {string}
 */
export function sessionJson(session, now = Date.now()) {
  return JSON.stringify(buildBackup([session], undefined, now), null, 2) + "\n";
}

/** @param {string} repo */
export function isValidRepo(repo) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

/**
 * User-facing message for an HTTP status.
 * @param {number} status
 * @returns {string}
 */
export function describeStatus(status) {
  if (status === 401) return "Invalid token";
  if (status === 403) return "Access denied (token permissions or rate limit)";
  if (status === 404) return "Repo not found or token has no access";
  if (status === 409 || status === 422) return "File conflict (sha)";
  if (status >= 500) return `GitHub error (${status})`;
  return `HTTP error ${status}`;
}

export class GithubError extends Error {
  /** @param {string} message @param {number} [status] 0 = network failure */
  constructor(message, status = 0) {
    super(message);
    this.name = "GithubError";
    this.status = status;
  }
}

// ---------------------------------------------------------------- storage helpers

/** @returns {Storage|null} */
function defaultStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {Storage|null} st @param {string} key @param {any} fallback
 */
function readJson(st, key, fallback) {
  try {
    const raw = st?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** @param {Storage|null} st @param {string} key @param {unknown} value */
function writeJson(st, key, value) {
  try { st?.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
}

/** @param {Storage|null} [st] @returns {string[]} */
export function outboxList(st = defaultStorage()) {
  const v = readJson(st, OUTBOX_KEY, []);
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

/** @param {string} id @param {Storage|null} [st] @returns {string[]} */
export function outboxAdd(id, st = defaultStorage()) {
  const list = outboxList(st);
  if (!list.includes(id)) list.push(id);
  writeJson(st, OUTBOX_KEY, list);
  return list;
}

/** @param {string} id @param {Storage|null} [st] @returns {string[]} */
export function outboxRemove(id, st = defaultStorage()) {
  const list = outboxList(st).filter((x) => x !== id);
  writeJson(st, OUTBOX_KEY, list);
  return list;
}

/** @param {Storage|null} st @returns {Record<string, string>} */
function readShas(st) {
  const v = readJson(st, SHAS_KEY, {});
  return v && typeof v === "object" ? v : {};
}

// ---------------------------------------------------------------- REST calls

/**
 * @param {string} token
 * @returns {Record<string, string>}
 */
function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** @param {string} path */
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

/**
 * @param {typeof fetch} fetchFn
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 */
async function call(fetchFn, url, init) {
  try {
    return await fetchFn(url, init);
  } catch (e) {
    throw new GithubError(`Network unavailable: ${/** @type {any} */ (e)?.message ?? e}`, 0);
  }
}

/**
 * Check that the repo is reachable with this token.
 * @param {{ fetch: typeof fetch, repo: string, token: string }} o
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function testConnection({ fetch: fetchFn, repo, token }) {
  if (!isValidRepo(repo)) return { ok: false, message: "Invalid repo: use the user/name format" };
  if (!token) return { ok: false, message: "Token missing" };
  try {
    const res = await call(fetchFn, `${API}/repos/${repo}`, { headers: headers(token) });
    if (!res.ok) return { ok: false, message: describeStatus(res.status) };
    const info = await res.json().catch(() => ({}));
    return info.private === false
      ? { ok: true, message: "OK, but the repo is public: the data would be visible to everyone" }
      : { ok: true, message: "OK, private repo" };
  } catch (e) {
    return { ok: false, message: /** @type {any} */ (e).message };
  }
}

/**
 * Create or update one file. `sha` is the blob sha of the existing file, if known.
 * On a sha conflict (409/422) the current sha is fetched and the PUT retried once.
 * @param {{ fetch: typeof fetch, repo: string, token: string, path: string,
 *           content: string, message: string, sha?: string|null }} o
 * @returns {Promise<string>} new sha of the file
 */
export async function putFile({ fetch: fetchFn, repo, token, path, content, message, sha }) {
  const url = `${API}/repos/${repo}/contents/${encodePath(path)}`;
  const encoded = utf8ToBase64(content);
  const put = (/** @type {string|null|undefined} */ s) =>
    call(fetchFn, url, {
      method: "PUT",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify(s ? { message, content: encoded, sha: s } : { message, content: encoded }),
    });

  let res = await put(sha);
  if (res.status === 409 || res.status === 422) {
    const got = await call(fetchFn, url, { headers: headers(token) });
    if (got.ok) {
      const info = await got.json().catch(() => ({}));
      res = await put(typeof info.sha === "string" ? info.sha : null);
    } else if (got.status === 404) {
      res = await put(null);
    } else {
      throw new GithubError(describeStatus(got.status), got.status);
    }
  }
  if (!res.ok) throw new GithubError(describeStatus(res.status), res.status);
  const info = await res.json().catch(() => ({}));
  const newSha = info?.content?.sha;
  if (typeof newSha !== "string") throw new GithubError("Unexpected GitHub response");
  return newSha;
}

// ---------------------------------------------------------------- uploader

/**
 * @typedef {Object} GithubConfig
 * @property {boolean} githubEnabled
 * @property {string} githubRepo
 * @property {string} githubToken
 */

/**
 * @typedef {Object} GithubStatus
 * @property {boolean} enabled
 * @property {boolean} busy
 * @property {number} pending       sessions waiting in the outbox
 * @property {number|null} lastAt   epoch ms of the last successful upload
 * @property {string|null} error    last error, null when the last attempt succeeded
 */

/**
 * @param {Object} o
 * @param {typeof fetch} o.fetch
 * @param {() => GithubConfig} o.getConfig
 * @param {(id: string) => Promise<Session|null>} o.getSession
 * @param {Storage|null} [o.storage]
 * @param {(status: GithubStatus) => void} [o.onStatus]
 * @param {(message: string, level?: "info"|"warn"|"error") => void} [o.log]
 */
export function createUploader({ fetch: fetchFn, getConfig, getSession, storage = defaultStorage(), onStatus, log }) {
  let busy = false;
  let error = /** @type {string|null} */ (null);
  /** @type {Promise<void>} Uploads run strictly one after the other. */
  let chain = Promise.resolve();

  const configured = () => {
    const c = getConfig();
    return c.githubEnabled && !!c.githubToken && isValidRepo(c.githubRepo);
  };

  /** @returns {GithubStatus} */
  function status() {
    const last = Number(storage?.getItem(LAST_KEY) ?? "");
    return {
      enabled: getConfig().githubEnabled,
      busy,
      pending: outboxList(storage).length,
      lastAt: Number.isFinite(last) && last > 0 ? last : null,
      error,
    };
  }
  const emit = () => { try { onStatus?.(status()); } catch { /* UI must not break uploads */ } };

  /** @param {string} id @returns {Promise<void>} */
  async function uploadOne(id) {
    const session = await getSession(id);
    if (!session || !session.sets.length) { outboxRemove(id, storage); return; }
    const { githubRepo: repo, githubToken: token } = getConfig();
    const shas = readShas(storage);
    const sha = await putFile({
      fetch: fetchFn, repo, token,
      path: sessionPath(session),
      content: sessionJson(session),
      message: commitMessage(session),
      sha: shas[id] ?? null,
    });
    shas[id] = sha;
    writeJson(storage, SHAS_KEY, shas);
    outboxRemove(id, storage);
    try { storage?.setItem(LAST_KEY, String(Date.now())); } catch { /* ignore */ }
  }

  async function flushNow() {
    if (!configured()) { emit(); return; }
    busy = true;
    emit();
    try {
      for (const id of outboxList(storage)) await uploadOne(id);
      error = null;
    } catch (e) {
      error = /** @type {any} */ (e)?.message ?? String(e);
      log?.(`GitHub: ${error}`, "warn");
    } finally {
      busy = false;
      emit();
    }
  }

  /** Upload everything in the outbox (no-op when disabled). Never rejects. @returns {Promise<void>} */
  function flush() {
    chain = chain.then(flushNow, flushNow);
    return chain;
  }

  return {
    flush,
    status,
    /**
     * Queue a session for upload and start sending. Callers do not need to await.
     * @param {string} sessionId
     * @returns {Promise<void>} resolves when this round of uploads finished
     */
    notifySession(sessionId) {
      if (!configured()) return Promise.resolve();
      outboxAdd(sessionId, storage);
      emit();
      return flush();
    },
  };
}
