import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../js/github.js";

const T0 = new Date(2026, 9, 21, 7, 5, 9).getTime(); // local 2026-10-21 07:05:09

const session = (extra = {}) => ({
  id: "abc123", startedAt: T0, endedAt: null,
  sets: [{ id: "s1", sessionId: "abc123", exercise: "squat", loadKg: 100, startedAt: T0, endedAt: T0 + 1000, reps: [], note: "è" }],
  ...extra,
});

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

const res = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Fake GitHub: `script` is a list of Responses (or Errors to throw) consumed in order. */
function fakeFetch(script) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const next = script.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

test("sessionPath uses local start time", () => {
  assert.equal(G.sessionPath(session()), "sessions/2026/10/2026-10-21_070509_abc123.json");
});

test("commitMessage", () => {
  assert.equal(G.commitMessage(session()), "Sessione 2026-10-21 – serie 1");
});

test("utf8ToBase64 handles non-ASCII", () => {
  const text = "è – 日本";
  assert.equal(Buffer.from(G.utf8ToBase64(text), "base64").toString("utf8"), text);
  const big = "x".repeat(100000) + "é";
  assert.equal(Buffer.from(G.utf8ToBase64(big), "base64").toString("utf8"), big);
});

test("sessionJson is pretty, backup-shaped and has no settings", () => {
  const txt = G.sessionJson(session(), 5);
  const o = JSON.parse(txt);
  assert.equal(o.schemaVersion, 1);
  assert.equal(o.exportedAt, 5);
  assert.equal(o.sessions[0].id, "abc123");
  assert.equal(o.settings, undefined);
  assert.match(txt, /\n  "sessions": \[/);
});

test("outbox add/remove is idempotent", () => {
  const st = memStorage();
  assert.deepEqual(G.outboxList(st), []);
  G.outboxAdd("a", st); G.outboxAdd("a", st); G.outboxAdd("b", st);
  assert.deepEqual(G.outboxList(st), ["a", "b"]);
  G.outboxRemove("a", st);
  assert.deepEqual(G.outboxList(st), ["b"]);
  st.setItem(G.OUTBOX_KEY, "garbage");
  assert.deepEqual(G.outboxList(st), []);
});

test("putFile creates without sha and sends required headers", async () => {
  const f = fakeFetch([res(201, { content: { sha: "n1" } })]);
  const sha = await G.putFile({ fetch: f, repo: "o/r", token: "tok", path: "sessions/a b.json", content: "é", message: "m" });
  assert.equal(sha, "n1");
  const c = f.calls[0];
  assert.equal(c.method, "PUT");
  assert.equal(c.url, "https://api.github.com/repos/o/r/contents/sessions/a%20b.json");
  assert.equal(c.headers.Authorization, "Bearer tok");
  assert.equal(c.headers.Accept, "application/vnd.github+json");
  assert.equal(c.headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.equal("sha" in c.body, false);
  assert.equal(Buffer.from(c.body.content, "base64").toString("utf8"), "é");
});

test("putFile updates with sha", async () => {
  const f = fakeFetch([res(200, { content: { sha: "n2" } })]);
  const sha = await G.putFile({ fetch: f, repo: "o/r", token: "t", path: "p.json", content: "x", message: "m", sha: "old" });
  assert.equal(sha, "n2");
  assert.equal(f.calls[0].body.sha, "old");
});

for (const status of [409, 422]) {
  test(`putFile refetches sha and retries once on ${status}`, async () => {
    const f = fakeFetch([res(status), res(200, { sha: "cur" }), res(200, { content: { sha: "n3" } })]);
    const sha = await G.putFile({ fetch: f, repo: "o/r", token: "t", path: "p.json", content: "x", message: "m", sha: "stale" });
    assert.equal(sha, "n3");
    assert.deepEqual(f.calls.map((c) => c.method), ["PUT", "GET", "PUT"]);
    assert.equal(f.calls[2].body.sha, "cur");
  });
}

test("putFile gives up after a second conflict", async () => {
  const f = fakeFetch([res(409), res(200, { sha: "cur" }), res(409)]);
  await assert.rejects(G.putFile({ fetch: f, repo: "o/r", token: "t", path: "p", content: "x", message: "m", sha: "s" }), { status: 409 });
});

test("putFile 401 -> Token non valido", async () => {
  const f = fakeFetch([res(401)]);
  await assert.rejects(G.putFile({ fetch: f, repo: "o/r", token: "bad", path: "p", content: "x", message: "m" }),
    (e) => e.status === 401 && e.message === "Token non valido");
});

test("testConnection messages", async () => {
  const base = { repo: "o/r", token: "t" };
  assert.deepEqual(await G.testConnection({ ...base, fetch: fakeFetch([res(200, { private: true })]) }), { ok: true, message: "OK, repo privato" });
  assert.equal((await G.testConnection({ ...base, fetch: fakeFetch([res(401)]) })).message, "Token non valido");
  assert.equal((await G.testConnection({ ...base, fetch: fakeFetch([res(404)]) })).message, "Repo non trovato o token senza accesso");
  assert.equal((await G.testConnection({ ...base, fetch: fakeFetch([res(200, { private: false })]) })).ok, true);
  const net = await G.testConnection({ ...base, fetch: fakeFetch([new Error("offline")]) });
  assert.equal(net.ok, false);
  assert.equal((await G.testConnection({ repo: "bad", token: "t", fetch: fakeFetch([]) })).ok, false);
});

function makeUploader(script, over = {}) {
  const storage = memStorage();
  const f = fakeFetch(script);
  const logs = [];
  const sessions = { abc123: session() };
  const up = G.createUploader({
    fetch: f,
    storage,
    getConfig: () => ({ githubEnabled: true, githubRepo: "o/r", githubToken: "tok", ...over }),
    getSession: async (id) => sessions[id] ?? null,
    log: (m) => logs.push(m),
  });
  return { up, f, storage, logs, sessions };
}

test("uploader: create, keep sha, then update with it; outbox cleared", async () => {
  const { up, f, storage } = makeUploader([res(201, { content: { sha: "s1" } }), res(200, { content: { sha: "s2" } })]);
  await up.notifySession("abc123");
  assert.deepEqual(G.outboxList(storage), []);
  assert.equal(JSON.parse(storage.getItem(G.SHAS_KEY)).abc123, "s1");
  assert.equal(up.status().error, null);
  assert.ok(up.status().lastAt > 0);
  await up.notifySession("abc123");
  assert.equal("sha" in f.calls[0].body, false);
  assert.equal(f.calls[1].body.sha, "s1");
  assert.equal(JSON.parse(storage.getItem(G.SHAS_KEY)).abc123, "s2");
  assert.equal(f.calls[0].body.message, "Sessione 2026-10-21 – serie 1");
});

test("uploader: sha mismatch retries via GET", async () => {
  const { up, f, storage } = makeUploader([res(422), res(200, { sha: "cur" }), res(200, { content: { sha: "z" } })]);
  storage.setItem(G.SHAS_KEY, JSON.stringify({ abc123: "stale" }));
  await up.notifySession("abc123");
  assert.deepEqual(G.outboxList(storage), []);
  assert.equal(f.calls[2].body.sha, "cur");
});

test("uploader: 401 keeps the session in the outbox and reports the error", async () => {
  const { up, storage, logs } = makeUploader([res(401)]);
  await up.notifySession("abc123");
  assert.deepEqual(G.outboxList(storage), ["abc123"]);
  assert.equal(up.status().error, "Token non valido");
  assert.equal(up.status().pending, 1);
  assert.match(logs[0], /Token non valido/);
});

test("uploader: network failure keeps outbox, later flush clears it", async () => {
  const { up, storage } = makeUploader([new TypeError("Failed to fetch"), res(201, { content: { sha: "s" } })]);
  await up.notifySession("abc123");
  assert.deepEqual(G.outboxList(storage), ["abc123"]);
  assert.match(up.status().error, /Rete non disponibile/);
  await up.flush();
  assert.deepEqual(G.outboxList(storage), []);
  assert.equal(up.status().error, null);
});

test("uploader: disabled or no token never touches the network or outbox", async () => {
  for (const over of [{ githubEnabled: false }, { githubToken: "" }]) {
    const { up, f, storage } = makeUploader([], over);
    await up.notifySession("abc123");
    assert.equal(f.calls.length, 0);
    assert.deepEqual(G.outboxList(storage), []);
  }
});

test("uploader: missing session is dropped from the outbox; concurrent notifies coalesce", async () => {
  const { up, f, storage } = makeUploader([res(201, { content: { sha: "a" } }), res(200, { content: { sha: "b" } })]);
  G.outboxAdd("gone", storage);
  await Promise.all([up.notifySession("abc123"), up.notifySession("abc123")]);
  assert.deepEqual(G.outboxList(storage), []);
  assert.equal(f.calls.length, 1);
});
