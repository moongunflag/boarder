// node --test apps/web/worker/member/routes.test.ts — API 계약 · 회원 경계(D1 대신 node:sqlite)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";

registerHooks({ resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(spec + ".ts", ctx); throw e; } } });
const { mountMember, notify, cardPush, kindOf } = await import("./routes.ts");

function d1(db: DatabaseSync) {
  const exec = (sql: string, args: unknown[]) => {
    const st = db.prepare(sql);
    if (/^\s*select/i.test(sql)) return { results: st.all(...(args as never[])).map(r => ({ ...r })), meta: { changes: 0 } };
    const r = st.run(...(args as never[])); return { results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => (exec(sql, args).results[0] ?? null),
    all: async () => exec(sql, args), run: async () => exec(sql, args),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (ss: { sql: string; args: unknown[] }[]) => { db.exec("BEGIN"); try { const out = ss.map(s => exec(s.sql, s.args)); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  };
}

// 회원 보드 표(0005 · 0019 칸만) 위에 이 기능의 마이그레이션 — 번호에 기대지 않고 이름 끝 _member_more.sql
function setup(vapid?: string) {
  const db = new DatabaseSync(":memory:");
  db.exec(`create table board_log (id integer primary key autoincrement, owner text not null, win text not null, kind text not null, text text not null, thread text, at integer not null, wid text);
    create table board_card (id text primary key, owner text not null, win text not null, question text not null, choices text not null, recommend text, body text, state text not null default 'open', answer text, answered_at integer, done text, at integer not null, wid text);`);
  const dir = new URL("../../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter(f => /_member_more\.sql$/.test(f)).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const sent: { me: string; wid: string; text: string }[] = [];
  const app = new Hono();
  mountMember(app, async c => c.req.header("x-test-user") || null, async (_c, me, wid, text) => { sent.push({ me, wid, text }); });
  const env = { DB: d1(db), VAPID_PRIVATE: vapid };
  const call = async (who: string | null, method: string, path: string, body?: unknown, hb = true) => {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (who) h["x-test-user"] = who; if (hb) h["x-hb"] = "1";
    const wait: Promise<unknown>[] = [];
    const r = await app.fetch(new Request("https://b.example" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p: Promise<unknown>) => wait.push(p), passThroughOnException() {} } as never);
    await Promise.all(wait);
    const text = await r.text();
    return { status: r.status, j: (r.headers.get("content-type") || "").includes("json") ? JSON.parse(text) : null, text };
  };
  const cardRow = (id: string, owner: string, kind: string, wid: string | null = "ew_abc123") =>
    db.prepare("INSERT INTO board_card(id, owner, win, question, choices, at, wid, kind) VALUES (?,?,?,?,?,?,?,?)").run(id, owner, "영업 창", "자료 받기", '["가","나"]', 1000, wid, kind);
  const say = (owner: string, thread: string, text: string, at: number) => db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").run(owner, "영업 창", "say", text, thread, at);
  const row = (id: string) => ({ ...(db.prepare("SELECT state, answer FROM board_card WHERE id = ?").get(id) as object) });
  const subs = (owner: string) => (db.prepare("SELECT endpoint FROM member_push WHERE owner = ? ORDER BY at").all(owner) as { endpoint: string }[]).map(r => r.endpoint);
  return { call, cardRow, say, row, subs, sent, env };
}
const A = "a@example.com", B = "b@example.com";
const sub = (n: number) => ({ sub: { endpoint: `https://push.example/s/${n}`, keys: { p256dh: "BPk", auth: "au" } }, ua: "test" });

test("로그인 없으면 401, 쓰기에 x-hb 없으면 403", async () => {
  const { call, cardRow } = setup(); cardRow("1793400000.000001", A, "todo");
  assert.equal((await call(null, "GET", "/api/me/todos")).status, 401);
  assert.equal((await call(A, "POST", "/api/me/cards/1793400000.000001/done", {}, false)).status, 403);
  assert.equal((await call(A, "POST", "/api/me/cards/1793400000.000001/reply", { text: "네" }, false)).status, 403);
  assert.equal((await call(A, "POST", "/api/me/push/sub", sub(1), false)).status, 403);
});

test("할 일: 내 열린 todo 카드만, 결정 카드 · 남의 카드는 안 보임", async () => {
  const { call, cardRow } = setup();
  cardRow("1793400000.000001", A, "todo"); cardRow("1793400000.000002", A, "decision"); cardRow("1793400000.000003", B, "todo");
  const r = await call(A, "GET", "/api/me/todos");
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.todos.map((t: { id: string }) => t.id), ["1793400000.000001"]);
});

test("할 일 끝냄: 그 창에 알리고 한 번만 — 결정 카드 · 남의 할 일은 404", async () => {
  const { call, cardRow, row, sent } = setup();
  cardRow("1793400000.000001", A, "todo"); cardRow("1793400000.000002", A, "decision"); cardRow("1793400000.000003", B, "todo");
  assert.equal((await call(A, "POST", "/api/me/cards/1793400000.000002/done", {})).status, 404);
  assert.equal((await call(A, "POST", "/api/me/cards/1793400000.000003/done", {})).status, 404);
  assert.equal(row("1793400000.000003").state, "open");
  assert.equal((await call(A, "POST", "/api/me/cards/1793400000.000001/done", {})).status, 200);
  assert.deepEqual(row("1793400000.000001"), { state: "answered", answer: "했어요" });
  assert.equal(sent.length, 1); assert.equal(sent[0].me, A); assert.equal(sent[0].wid, "ew_abc123");
  assert.equal((await call(A, "POST", "/api/me/cards/1793400000.000001/done", {})).status, 404);   // 두 번째는 없음
  assert.equal(sent.length, 1);
});

test("카드 스레드: 에이전트 줄 + 내 답이 시간 순, 답은 카드를 낸 창으로", async () => {
  const { call, cardRow, say, sent } = setup();
  cardRow("1793400000.000001", A, "decision");
  say(A, "1793400000.000001", "자료 목록 올렸어요", 2000);
  say(A, "other", "다른 스레드", 2500);
  const r = await call(A, "POST", "/api/me/cards/1793400000.000001/reply", { text: "  확인했어요\u0007  " });
  assert.equal(r.status, 200); assert.equal(r.j.delivered, true);
  const t = await call(A, "GET", "/api/me/cards/1793400000.000001/thread");
  assert.equal(t.status, 200);
  assert.deepEqual(t.j.messages.map((m: { who: string; text: string }) => [m.who, m.text]), [["agent", "자료 목록 올렸어요"], ["me", "확인했어요"]]);
  assert.deepEqual(t.j.card.choices, ["가", "나"]);
  assert.equal(sent.length, 1); assert.match(sent[0].text, /확인했어요$/);
});

test("카드 스레드: 남의 카드는 404(있는지도 안 알림), 빈 답은 400, 창 없는 카드는 넣기만", async () => {
  const { call, cardRow, sent } = setup();
  cardRow("1793400000.000003", B, "decision"); cardRow("1793400000.000004", A, "question", null);
  assert.equal((await call(A, "GET", "/api/me/cards/1793400000.000003/thread")).status, 404);
  assert.equal((await call(A, "POST", "/api/me/cards/1793400000.000003/reply", { text: "엿보기" })).status, 404);
  assert.equal((await call(A, "POST", "/api/me/cards/1793400000.000004/reply", { text: "   " })).status, 400);
  const r = await call(A, "POST", "/api/me/cards/1793400000.000004/reply", { text: "메모" });
  assert.equal(r.status, 200); assert.equal(r.j.delivered, false); assert.equal(sent.length, 0);
});

test("푸시 구독: 꼴이 틀리면 400, 한 사람 10개까지(오래된 것부터 빠짐), 끊기는 내 것만", async () => {
  const { call, subs } = setup();
  assert.equal((await call(A, "POST", "/api/me/push/sub", { sub: { endpoint: "http://x/1", keys: { p256dh: "a", auth: "b" } } })).status, 400);
  for (let i = 1; i <= 12; i++) assert.equal((await call(A, "POST", "/api/me/push/sub", sub(i))).status, 200);
  await call(B, "POST", "/api/me/push/sub", sub(99));
  assert.equal(subs(A).length, 10); assert.ok(!subs(A).includes("https://push.example/s/1"));
  await call(B, "POST", "/api/me/push/unsub", { endpoint: "https://push.example/s/12" });
  assert.ok(subs(A).includes("https://push.example/s/12"));
  await call(A, "POST", "/api/me/push/unsub", { endpoint: "https://push.example/s/12" });
  assert.ok(!subs(A).includes("https://push.example/s/12"));
});

test("푸시 열쇠: 비밀값이 없으면 빈 키 · 보내기 0", async () => {
  const { call, env } = setup();
  assert.deepEqual((await call(A, "GET", "/api/me/push/key")).j, { key: "" });
  assert.equal(await notify(env as never, A, cardPush("1", "todo", "q", "w"), async () => new Response(null, { status: 201 })), 0);
});

test("푸시 보내기: 그 회원 기기에만, 끊긴 구독(410)은 지움", async () => {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const d = (await crypto.subtle.exportKey("jwk", k.privateKey)).d!;
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = Buffer.from(await crypto.subtle.exportKey("raw", ua.publicKey) as ArrayBuffer).toString("base64url"), auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
  const { call, env, subs } = setup(d);
  assert.ok((await call(A, "GET", "/api/me/push/key")).j.key.length > 40);
  const live = { sub: { endpoint: "https://push.example/live", keys: { p256dh: pub, auth } } }, gone = { sub: { endpoint: "https://push.example/gone", keys: { p256dh: pub, auth } } };
  await call(A, "POST", "/api/me/push/sub", live); await call(A, "POST", "/api/me/push/sub", gone); await call(B, "POST", "/api/me/push/sub", { sub: { endpoint: "https://push.example/b", keys: { p256dh: pub, auth } } });
  const hit: string[] = [];
  const n = await notify(env as never, A, cardPush("1793400000.000001", "todo", "자료 받기", "영업 창"), async (u: string | URL | Request) => { hit.push(String(u)); return new Response(null, { status: String(u).endsWith("gone") ? 410 : 201 }); });
  assert.equal(n, 1);
  assert.deepEqual(hit.sort(), ["https://push.example/gone", "https://push.example/live"]);
  assert.deepEqual(subs(A), ["https://push.example/live"]);
  assert.deepEqual(subs(B), ["https://push.example/b"]);
});

test("카드 종류: 모르는 값은 decision", () => {
  assert.equal(kindOf("todo"), "todo"); assert.equal(kindOf("won"), "decision"); assert.equal(kindOf(undefined), "decision");
  assert.equal(cardPush("1.2", "todo", "자료", "창").title, "할 일 · 창");
});

test("내 앞의 카드: 결정 · 할 일 따로, 스레드 줄 수, 남의 카드 없음", async () => {
  const { call, cardRow, say } = setup();
  cardRow("1793400000.000001", A, "todo"); cardRow("1793400000.000002", A, "decision"); cardRow("1793400000.000003", B, "decision");
  say(A, "1793400000.000002", "근거", 1500); say(A, "1793400000.000002", "더", 1600);
  const r = await call(A, "GET", "/api/me/inbox");
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.cards.map((x: { id: string; replies: number }) => [x.id, x.replies]), [["1793400000.000002", 2]]);
  assert.deepEqual(r.j.todos.map((x: { id: string }) => x.id), ["1793400000.000001"]);
  assert.deepEqual(r.j.answered, []);
});
