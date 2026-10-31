// 회원 보드(우리 판 — 보드 틀이 공개 밖이라 앱으로): 내 차례 카드 · 할 일 · 카드 스레드 · 창 · Primary 채팅 · 알림 켜기.
// 넓으면 두 칸(왼쪽 카드 · 할 일, 오른쪽 창 · 채팅), 좁으면 위 탭 넷. 20초마다 다시 읽음(보드와 같음)
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Card = { id: string; win: string; kind: string; title: string; body: string; choices: string[]; recommend: string | null; state: string; answer: string | null; at: number; replies: number };
type Inbox = { cards: Card[]; todos: Card[]; answered: Card[] };
type Line = { ago: number; kind: string; msg: string };
type Pane = { pane: string; win: string; kind: string; state: string; cwd: string; last: Line | null; recent: Line[] };
type Data = { panes: Pane[]; parked: { pane: string; name: string; msg: string; ago: number }[]; feed: { id: number; ago: number; win: string; kind: string; msg: string }[] };
type Msg = { ts: string; who: string; name: string; text: string };
type TMsg = { id: number; who: "me" | "agent"; win: string; text: string; at: number };
type Res<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const ERR = "일시적인 오류가 발생했어요";
async function api<T>(method: string, path: string, body?: unknown): Promise<Res<T>> {
  const r = await fetch(path, { method, credentials: "include", headers: { "content-type": "application/json", "x-hb": "1" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) as Record<string, unknown> : {};
  return r?.ok && j.ok !== false ? { ok: true, ...j } as Res<T> : { ok: false, error: typeof j.error === "string" ? j.error : ERR, status: r?.status || 0 };
}
const KIND_KO: Record<string, string> = { decision: "결정", question: "질문", approval: "승인", todo: "할 일" };
const when = (ms: number) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60_000)); return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
const ago = (m: number) => m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
const BTN = "h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[14px] disabled:opacity-50";
const PRI = "h-9 rounded-lg bg-[var(--ink)] px-3 text-[14px] text-[var(--bg)] disabled:opacity-50";
const INPUT = "h-10 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[15px]";

function useWide() {
  const q = "(min-width: 861px)", [w, setW] = useState(() => matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), f = () => setW(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return w;
}
// 20초마다 · 화면에 돌아올 때 다시 읽기
function usePoll(load: () => Promise<void>) {
  useEffect(() => {
    load(); const t = setInterval(() => document.visibilityState === "visible" && load(), 20_000), v = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [load]);
}

export function MemberBoard({ email }: { email: string }) {
  const wide = useWide(), [tab, setTab] = useState<"cards" | "todos" | "wins" | "chat">("cards");
  const [ib, setIb] = useState<Inbox | null>(null), [D, setD] = useState<Data | null>(null), [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(() => /^#card=(.+)$/.exec(location.hash)?.[1] ? decodeURIComponent(/^#card=(.+)$/.exec(location.hash)![1]) : null);
  const tag = useRef("");
  const loadIb = useCallback(async () => { const r = await api<Inbox>("GET", "/api/me/inbox"); r.ok ? (setIb(r), setErr("")) : setErr(r.error); }, []);
  const loadD = useCallback(async () => {
    const r = await fetch("/api/data", { credentials: "include", headers: { "x-hb": "1", ...(tag.current ? { "If-None-Match": tag.current } : {}) } }).catch(() => null);
    if (!r || r.status === 304 || !r.ok) return; tag.current = r.headers.get("etag") || ""; setD(await r.json());
  }, []);
  usePoll(loadIb); usePoll(loadD);
  useEffect(() => { const f = () => { const m = /^#card=(.+)$/.exec(location.hash); if (m) setOpen(decodeURIComponent(m[1])); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const refresh = () => { loadIb(); loadD(); };
  if (!ib && !err) return <div className="grid min-h-dvh place-items-center"><span className="g g-spin" aria-label="불러오는 중" /></div>;

  const cards = <Section title="내 차례" n={ib?.cards.length}>{ib?.cards.length ? ib.cards.map(c => <CardBox key={c.id} c={c} open={open === c.id} onOpen={v => setOpen(v ? c.id : null)} onDone={refresh} />) : <Empty>답할 카드가 없어요</Empty>}
    {!!ib?.answered.length && <details className="mt-2 text-[14px]"><summary className="cursor-pointer text-[var(--soft)]">오늘 답한 것 {ib.answered.length}</summary>
      <div className="mt-2 flex flex-col gap-2">{ib.answered.map(c => <CardBox key={c.id} c={c} open={open === c.id} onOpen={v => setOpen(v ? c.id : null)} onDone={refresh} />)}</div></details>}
  </Section>;
  const todos = <Section title="할 일" n={ib?.todos.length}>{ib?.todos.length ? ib.todos.map(c => <CardBox key={c.id} c={c} open={open === c.id} onOpen={v => setOpen(v ? c.id : null)} onDone={refresh} />) : <Empty>에이전트가 부탁한 할 일이 없어요</Empty>}</Section>;
  const wins = <Section title="창" n={D?.panes.filter(p => p.kind !== "primary").length}>{D ? <Wins D={D} onSent={loadD} /> : <Empty>불러오는 중</Empty>}</Section>;
  const chat = <Section title="Primary"><Chat /></Section>;
  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--ink)]">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)] px-4 py-3">
        <b className="text-[17px]">보드</b>
        <span className="truncate text-[13px] text-[var(--soft)]">{email}</span>
        <div className="flex-1" />
        <PushBtn />
        <a className={BTN + " inline-flex items-center"} href="/sales">영업 보드</a>
      </div>
      {err && <p className="px-4 pt-3 text-[14px] text-[var(--danger)]">{err}</p>}
      {wide ? (
        <div className="mx-auto grid max-w-[1280px] grid-cols-2 gap-6 p-4">
          <div className="flex flex-col gap-6">{cards}{todos}</div>
          <div className="flex flex-col gap-6">{wins}{chat}</div>
        </div>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto px-4 pt-3" role="tablist">
            {([["cards", "내 차례", ib?.cards.length], ["todos", "할 일", ib?.todos.length], ["wins", "창", 0], ["chat", "채팅", 0]] as const).map(([k, n, c]) =>
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={"h-9 shrink-0 rounded-full px-3 text-[14px] " + (tab === k ? "bg-[var(--ink)] text-[var(--bg)]" : "border border-[var(--line)]")} onClick={() => setTab(k)}>{n}{c ? ` ${c}` : ""}</button>)}
          </div>
          <div className="p-4">{tab === "cards" ? cards : tab === "todos" ? todos : tab === "wins" ? wins : chat}</div>
        </>
      )}
    </div>
  );
}

function Section({ title, n, children }: { title: string; n?: number; children: ReactNode }) {
  return <section className="flex flex-col gap-2"><h2 className="text-[15px] font-semibold">{title}{n ? <span className="ml-1 text-[var(--soft)]">{n}</span> : null}</h2>{children}</section>;
}
const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed border-[var(--line)] p-4 text-[14px] text-[var(--soft)]">{children}</p>;

// 카드 하나: 선택지 단추 · 직접 적기 · 할 일 끝냄 · 스레드(에이전트 줄 + 내 답)
function CardBox({ c, open, onOpen, onDone }: { c: Card; open: boolean; onOpen: (v: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [free, setFree] = useState("");
  const todo = c.kind === "todo", live = c.state === "open";
  const act = async (p: Promise<Res<object>>) => { setBusy(true); setErr(""); const r = await p; setBusy(false); r.ok ? onDone() : setErr(r.error); };
  const answer = (choice: string, isFree = false) => act(api("POST", `/api/me/cards/${encodeURIComponent(c.id)}/answer`, { choice, free: isFree }));
  const choices = c.recommend && c.choices.includes(c.recommend) ? [c.recommend, ...c.choices.filter(x => x !== c.recommend)] : c.choices;
  return (
    <article id={"card-" + c.id} className={"flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-3 " + (open ? "border-[var(--ink)]" : "border-[var(--line)]")}>
      <div className="flex items-center gap-2 text-[12px] text-[var(--soft)]">
        <span className="rounded-full bg-[var(--bg)] px-2 py-0.5">{KIND_KO[c.kind] || "결정"}</span><span className="truncate">{c.win}</span><span className="ml-auto shrink-0">{when(c.at)}</span>
      </div>
      <p className="whitespace-pre-wrap text-[15px] font-medium">{c.title}</p>
      {c.body && <p className="whitespace-pre-wrap text-[14px] text-[var(--soft)]">{c.body}</p>}
      {!live && <p className="text-[14px]">답: <b>{c.answer}</b></p>}
      {live && todo && <div><button type="button" className={PRI} disabled={busy} onClick={() => act(api("POST", `/api/me/cards/${encodeURIComponent(c.id)}/done`, {}))}>했어요</button></div>}
      {live && !todo && <>
        <div className="flex flex-wrap gap-2">{choices.map((x, i) => <button key={x} type="button" className={i === 0 && c.recommend ? PRI : BTN} disabled={busy} onClick={() => answer(x)}>{x}</button>)}</div>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (free.trim()) answer(free.trim(), true); }}>
          <input className={INPUT} placeholder="직접 적어 답하기" value={free} maxLength={2000} onChange={e => setFree(e.target.value)} />
          <button className={BTN} disabled={busy || !free.trim()}>보내기</button>
        </form>
      </>}
      {err && <p className="text-[13px] text-[var(--danger)]">{err}</p>}
      <button type="button" className="self-start text-[13px] text-[var(--soft)] underline" onClick={() => onOpen(!open)}>{open ? "스레드 닫기" : `스레드${c.replies ? ` ${c.replies}` : ""}`}</button>
      {open && <Thread id={c.id} onSent={onDone} />}
    </article>
  );
}

function Thread({ id, onSent }: { id: string; onSent: () => void }) {
  const [ms, setMs] = useState<TMsg[] | null>(null), [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [note, setNote] = useState("");
  const load = useCallback(async () => { const r = await api<{ messages: TMsg[] }>("GET", `/api/me/cards/${encodeURIComponent(id)}/thread`); r.ok ? setMs(r.messages) : setErr(r.error); }, [id]);
  usePoll(load);
  const send = async () => {
    setBusy(true); setErr(""); const r = await api<{ delivered: boolean }>("POST", `/api/me/cards/${encodeURIComponent(id)}/reply`, { text }); setBusy(false);
    if (!r.ok) return setErr(r.error);
    setText(""); setNote(r.delivered ? "" : "이 카드를 낸 창이 없어 글만 남겼어요"); load(); onSent();
  };
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-2">
      {!ms ? <span className="g g-spin" aria-label="불러오는 중" /> : !ms.length ? <p className="text-[13px] text-[var(--soft)]">아직 글이 없어요</p> :
        ms.map(m => <div key={m.id} className={"max-w-[90%] rounded-lg px-3 py-2 text-[14px] " + (m.who === "me" ? "self-end bg-[var(--ink)] text-[var(--bg)]" : "self-start bg-[var(--bg)]")}>
          <div className="mb-0.5 text-[11px] opacity-70">{m.who === "me" ? "나" : m.win} · {when(m.at)}</div><div className="whitespace-pre-wrap break-words">{m.text}</div></div>)}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) send(); }}>
        <input className={INPUT} placeholder="스레드에 답하기 — 카드를 낸 창으로 가요" value={text} maxLength={3000} onChange={e => setText(e.target.value)} />
        <button className={BTN} disabled={busy || !text.trim()}>보내기</button>
      </form>
      {(err || note) && <p className={"text-[13px] " + (err ? "text-[var(--danger)]" : "text-[var(--soft)]")}>{err || note}</p>}
    </div>
  );
}

// 창(노드 · 엔진 창): 상태 · 마지막 줄 · 최근 다섯 줄, 글 넣기
function Wins({ D, onSent }: { D: Data; onSent: () => void }) {
  const ps = D.panes.filter(p => p.kind !== "primary");
  return <>
    {ps.length ? ps.map(p => <WinBox key={p.pane} p={p} onSent={onSent} />) : <Empty>연결된 창이 없어요</Empty>}
    {!!D.parked.length && <details className="text-[14px]"><summary className="cursor-pointer text-[var(--soft)]">쉬는 창 {D.parked.length}</summary>
      <ul className="mt-2 flex flex-col gap-1">{D.parked.map(p => <li key={p.pane} className="text-[13px]"><b>{p.name}</b> <span className="text-[var(--soft)]">{p.msg} · {ago(p.ago)}</span></li>)}</ul></details>}
  </>;
}
function WinBox({ p, onSent }: { p: Pane; onSent: () => void }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const send = async () => { setBusy(true); setErr(""); const r = await api("POST", "/api/chat", { pane: p.pane, text }); setBusy(false); r.ok ? (setText(""), onSent()) : setErr(r.error); };
  const busyState = p.state === "일하는 중" || p.state === "뒤 작업 중";
  return (
    <article className="flex flex-col gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <button type="button" className="flex items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <i className={"h-2 w-2 shrink-0 rounded-full " + (busyState ? "bg-[var(--dgit-green)]" : p.state === "질문" ? "bg-[var(--dgit-amber)]" : "bg-[var(--line)]")} aria-hidden="true" />
        <b className="truncate text-[15px]">{p.win}</b><span className="shrink-0 text-[12px] text-[var(--soft)]">{p.state}</span>
        {p.last && <span className="ml-auto shrink-0 text-[12px] text-[var(--soft)]">{ago(p.last.ago)}</span>}
      </button>
      {p.last && <p className="line-clamp-2 text-[13px] text-[var(--soft)]">[{p.last.kind}] {p.last.msg}</p>}
      {open && <div className="flex flex-col gap-2 pt-1">
        {!!p.recent.length && <ul className="flex flex-col gap-1">{p.recent.map((l, i) => <li key={i} className="whitespace-pre-wrap text-[13px]"><span className="text-[var(--soft)]">{ago(l.ago)} [{l.kind}]</span> {l.msg}</li>)}</ul>}
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) send(); }}>
          <input className={INPUT} placeholder="이 창에 글 넣기" value={text} maxLength={3000} onChange={e => setText(e.target.value)} />
          <button className={BTN} disabled={busy || !text.trim()}>보내기</button>
        </form>
        {err && <p className="text-[13px] text-[var(--danger)]">{err}</p>}
      </div>}
    </article>
  );
}

function Chat() {
  const [ms, setMs] = useState<Msg[] | null>(null), [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const load = useCallback(async () => { const r = await api<{ messages: Msg[] }>("GET", "/api/chat/primary"); if (r.ok) setMs(r.messages); }, []);
  usePoll(load);
  const send = async () => { setBusy(true); setErr(""); const r = await api("POST", "/api/chat", { channel: "primary", text }); setBusy(false); r.ok ? (setText(""), load()) : setErr(r.error); };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto">
        {!ms ? <span className="g g-spin" aria-label="불러오는 중" /> : !ms.length ? <p className="text-[13px] text-[var(--soft)]">메인 봇에게 첫 글을 남겨 보세요</p> :
          ms.slice(-60).map(m => <div key={m.ts} className={"max-w-[90%] rounded-lg px-3 py-2 text-[14px] " + (m.who === "owner" ? "self-end bg-[var(--ink)] text-[var(--bg)]" : "self-start bg-[var(--bg)]")}><div className="whitespace-pre-wrap break-words">{m.text}</div></div>)}
      </div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) send(); }}>
        <input className={INPUT} placeholder="메인 봇에게" value={text} maxLength={3000} onChange={e => setText(e.target.value)} />
        <button className={BTN} disabled={busy || !text.trim()}>보내기</button>
      </form>
      {err && <p className="text-[13px] text-[var(--danger)]">{err}</p>}
    </div>
  );
}

// 알림 켜기: 서비스 워커(/sw.js) + 푸시 구독 → /api/me/push/sub. 이 판에 열쇠가 없거나 브라우저가 못 하면 단추를 숨김
const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
function PushBtn() {
  const [key, setKey] = useState(""), [on, setOn] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  useEffect(() => {
    if (!ok) return;
    api<{ key: string }>("GET", "/api/me/push/key").then(r => r.ok && setKey(r.key));
    navigator.serviceWorker.getRegistration("/").then(g => g?.pushManager.getSubscription()).then(s => setOn(!!s), () => setOn(false));
  }, [ok]);
  if (!ok || !key) return null;
  const turnOn = async () => {
    setBusy(true); setErr("");
    try {
      if (await Notification.requestPermission() !== "granted") throw new Error("브라우저에서 알림을 허용해 주세요");
      const g = await navigator.serviceWorker.register("/sw.js", { scope: "/" }); await navigator.serviceWorker.ready;
      const s = await g.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      const r = await api("POST", "/api/me/push/sub", { sub: s.toJSON(), ua: navigator.userAgent }); if (!r.ok) throw new Error(r.error);
      setOn(true);
    } catch (e) { setErr((e as Error).message || ERR); }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true);
    const g = await navigator.serviceWorker.getRegistration("/"), s = await g?.pushManager.getSubscription();
    if (s) { await api("POST", "/api/me/push/unsub", { endpoint: s.endpoint }); await s.unsubscribe().catch(() => {}); }
    setOn(false); setBusy(false);
  };
  return <span className="flex items-center gap-2">
    {err && <span className="text-[12px] text-[var(--danger)]">{err}</span>}
    <button type="button" className={BTN} disabled={busy || on === null} onClick={on ? turnOff : turnOn}>{on ? "알림 끄기" : "알림 켜기"}</button>
  </span>;
}
