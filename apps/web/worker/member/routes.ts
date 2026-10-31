// 회원 보드 더하기(우리 판) — 할 일 · 카드 스레드 답 · 웹 푸시. 회원 길(owner = 메일)만, 주인 길(사본 · 다리)은 그대로
import type { Context, Hono } from "hono";
import * as PU from "../push";

type Env = { DB: D1Database; VAPID_PRIVATE?: string; PUBLIC_URL?: string };
type C = Context<{ Bindings: Env }>;
type Who = (c: C) => Promise<string | null>;   // 회원 메일(소문자) — 주인 · 로그인 안 함이면 null
type Deliver = (c: C, me: string, wid: string, text: string) => Promise<unknown>;   // 카드를 낸 창에 한 줄 넣기(engine.deliverTo)

export const ME = "나";   // 회원이 쓴 줄의 win(member-board 와 같음)
export const KINDS = ["decision", "approval", "question", "todo"] as const;
export const DONE = "했어요";
const TEXT_MAX = 3000, SUBS_MAX = 10, THREAD_MAX = 300;
const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g;
const clean = (v: unknown, n: number) => typeof v === "string" ? v.replace(CTRL, " ").trim().slice(0, n) : "";
const sameSite = (c: C) => c.req.header("x-hb") === "1" && ["same-origin", "none", undefined].includes(c.req.header("sec-fetch-site"));
const body = (c: C) => c.req.json<Record<string, unknown>>().then(b => b && typeof b === "object" && !Array.isArray(b) ? b : null, () => null);
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) as T : d; } catch { return d; } };
export const kindOf = (v: unknown) => (KINDS as readonly string[]).includes(String(v)) ? String(v) : "decision";

type Card = { id: string; win: string; kind: string; question: string; choices: string; recommend: string | null; body: string | null; state: string; answer: string | null; at: number; wid: string | null };

export function mountMember(host: Hono<any>, who: Who, deliver: Deliver) {
  const app = host as unknown as Hono<{ Bindings: Env }>;
  const me = async (c: C, write = false) => {
    if (write && !sameSite(c)) return { err: c.json({ ok: false, error: "forbidden" }, 403) };
    const e = await who(c); if (!e) return { err: c.json({ ok: false, error: "로그인" }, 401) };
    return { e };
  };
  const card = (db: D1Database, me: string, id: string) =>
    db.prepare("SELECT id, win, kind, question, choices, recommend, body, state, answer, at, wid FROM board_card WHERE id = ? AND owner = ?").bind(id, me).first<Card>();
  const tell = (c: C, me: string, wid: string | null, text: string) => { if (wid) c.executionCtx.waitUntil(deliver(c, me, wid, text).then(() => {}, e => console.error("카드 창에 넣기", e))); };

  // 내 앞의 카드: 열린 결정 · 질문 · 승인 + 열린 할 일 + 하루 안에 답한 것 — 스레드 줄 수와 함께(우리 판 보드 화면이 읽음)
  app.get("/api/me/inbox", async c => {
    const m = await me(c); if (m.err) return m.err;
    const rs = await c.env.DB.prepare(`SELECT k.id, k.win, k.kind, k.question, k.choices, k.recommend, k.body, k.state, k.answer, k.at,
        (SELECT count(*) FROM board_log l WHERE l.owner = k.owner AND l.thread = k.id) AS n
      FROM board_card k WHERE k.owner = ? AND (k.state = 'open' OR (k.state = 'answered' AND k.answered_at > ?)) ORDER BY k.at DESC LIMIT 150`).bind(m.e, Date.now() - 86_400_000).all<Card & { n: number }>();
    const view = (r: Card & { n: number }) => ({ id: r.id, win: r.win, kind: r.kind, title: r.question, body: r.body || "", choices: json<string[]>(r.choices, []), recommend: r.recommend, state: r.state, answer: r.answer, at: r.at, replies: Number(r.n) });
    const open = rs.results.filter(r => r.state === "open");
    return c.json({ cards: open.filter(r => r.kind !== "todo").map(view), todos: open.filter(r => r.kind === "todo").map(view), answered: rs.results.filter(r => r.state !== "open").slice(0, 30).map(view) });
  });

  // 할 일 = 에이전트가 kind todo 로 낸 열린 카드(사람이 할 일). 결정 카드 목록과 따로 보임
  app.get("/api/me/todos", async c => {
    const m = await me(c); if (m.err) return m.err;
    const rs = await c.env.DB.prepare("SELECT id, win, question, body, at FROM board_card WHERE owner = ? AND kind = 'todo' AND state = 'open' ORDER BY at DESC LIMIT 100").bind(m.e).all<Card>();
    return c.json({ todos: rs.results.map(r => ({ id: r.id, win: r.win, title: r.question, body: r.body || "", at: r.at })) });
  });
  app.post("/api/me/cards/:id/done", async c => {
    const m = await me(c, true); if (m.err) return m.err;
    const id = c.req.param("id"), now = Date.now();
    const r = await c.env.DB.prepare("UPDATE board_card SET state = 'answered', answer = ?, answered_at = ? WHERE id = ? AND owner = ? AND kind = 'todo' AND state = 'open'").bind(DONE, now, id, m.e).run();
    if (!r.meta.changes) return c.json({ ok: false, error: "없는 할 일이에요" }, 404);
    const k = await card(c.env.DB, m.e, id);
    tell(c, m.e, k?.wid ?? null, `[Boarder] The person marked your to-do ${id} ("${(k?.question || "").slice(0, 120)}") as done. Continue.`);
    return c.json({ ok: true });
  });

  // 카드 스레드: 에이전트가 inbox_say 로 쓴 줄(board_log.thread = 카드 id) + 사람이 단 답(kind me)
  app.get("/api/me/cards/:id/thread", async c => {
    const m = await me(c); if (m.err) return m.err;
    const k = await card(c.env.DB, m.e, c.req.param("id")); if (!k) return c.json({ ok: false, error: "없는 카드예요" }, 404);
    const rs = await c.env.DB.prepare(`SELECT id, win, kind, text, at FROM (SELECT id, win, kind, text, at FROM board_log WHERE owner = ? AND thread = ? ORDER BY at DESC, id DESC LIMIT ${THREAD_MAX}) ORDER BY at, id`).bind(m.e, k.id).all<{ id: number; win: string; kind: string; text: string; at: number }>();
    return c.json({
      card: { id: k.id, win: k.win, kind: k.kind, title: k.question, body: k.body || "", choices: json<string[]>(k.choices, []), recommend: k.recommend, state: k.state, answer: k.answer, at: k.at },
      messages: rs.results.map(r => ({ id: r.id, who: r.kind === "me" ? "me" : "agent", win: r.win, text: r.text, at: r.at })),
    });
  });
  app.post("/api/me/cards/:id/reply", async c => {
    const m = await me(c, true); if (m.err) return m.err;
    const b = await body(c), text = clean(b?.text, TEXT_MAX); if (!text) return c.json({ ok: false, error: "내용을 적어요" }, 400);
    const k = await card(c.env.DB, m.e, c.req.param("id")); if (!k) return c.json({ ok: false, error: "없는 카드예요" }, 404);
    await c.env.DB.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").bind(m.e, ME, "me", text, k.id, Date.now()).run();
    tell(c, m.e, k.wid, `[Boarder] The person replied in the thread of your card ${k.id} ("${k.question.slice(0, 120)}"): ${text}`);
    return c.json({ ok: true, delivered: !!k.wid });
  });

  // 웹 푸시(회원): 서비스 워커 · 열쇠 · 구독 · 끊기. 보내기는 notify(카드가 설 때). 주인의 /sw.js 는 원래 길(index.ts pushRoute)로
  app.get("/sw.js", async (c, next) => {
    if (!(await who(c))) return next();
    return new Response(PU.SW, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" } });
  });
  app.get("/api/me/push/key", async c => {
    const m = await me(c); if (m.err) return m.err;
    const v = await PU.vapidKey(c.env.VAPID_PRIVATE);
    return c.json({ key: v?.pub || "" });   // 빈 키 = 이 판에 푸시 열쇠가 없음(화면이 단추를 숨김)
  });
  app.post("/api/me/push/sub", async c => {
    const m = await me(c, true); if (m.err) return m.err;
    const s = PU.subOf((await body(c)) || {}); if (!s) return c.json({ ok: false, error: "구독 꼴이 틀려요" }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO member_push(owner, endpoint, p256dh, auth, ua, at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, at = excluded.at").bind(m.e, s.endpoint, s.p256dh, s.auth, s.ua, Date.now()),
      // 한 사람 기기 SUBS_MAX 개까지 — 넘으면 오래된 것부터
      c.env.DB.prepare(`DELETE FROM member_push WHERE owner = ? AND endpoint NOT IN (SELECT endpoint FROM member_push WHERE owner = ? ORDER BY at DESC, rowid DESC LIMIT ${SUBS_MAX})`).bind(m.e, m.e),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/me/push/unsub", async c => {
    const m = await me(c, true); if (m.err) return m.err;
    const ep = clean((await body(c))?.endpoint, 1000); if (!ep) return c.json({ ok: false, error: "endpoint" }, 400);
    await c.env.DB.prepare("DELETE FROM member_push WHERE owner = ? AND endpoint = ?").bind(m.e, ep).run();
    return c.json({ ok: true });
  });
}

// 카드 알림 글: 할 일 · 결정 · 질문 — 누르면 보드(그 카드)로
export function cardPush(id: string, kind: string, question: string, win: string): PU.Msg {
  const head = kind === "todo" ? "할 일" : kind === "question" ? "질문" : kind === "approval" ? "승인" : "결정";
  return { title: `${head} · ${win.slice(0, 40)}`, body: question.slice(0, 200), url: `./#card=${encodeURIComponent(id)}`, tag: `card:${id}` };
}

// 그 회원 기기 전부에 보냄 → 보낸 수. 끊긴 구독(404 · 410 · 꼴 틀림)은 지움. 열쇠가 없으면 0
export async function notify(env: Env, owner: string, msg: PU.Msg, fetcher: typeof fetch = fetch) {
  const v = await PU.vapidKey(env.VAPID_PRIVATE); if (!v) return 0;
  const subs = (await env.DB.prepare("SELECT endpoint, p256dh, auth FROM member_push WHERE owner = ?").bind(owner).all<PU.Sub>()).results;
  const data = new TextEncoder().encode(JSON.stringify(msg));
  const codes = await Promise.all(subs.map(s => PU.sendOne(v, s, data, fetcher)));
  const gone = subs.filter((_, i) => PU.dead(codes[i]));
  if (gone.length) await env.DB.batch(gone.map(s => env.DB.prepare("DELETE FROM member_push WHERE owner = ? AND endpoint = ?").bind(owner, s.endpoint)));
  return codes.filter(x => typeof x === "number" && x >= 200 && x < 300).length;
}
