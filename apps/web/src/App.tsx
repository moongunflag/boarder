import { useEffect, useState, type ReactNode } from "react";
import { SignIn } from "./SignIn";
import { Device } from "./Device";
import { Sales } from "./Sales";
import { MemberBoard } from "./MemberBoard";
import { Frame, type Counts } from "./Frame";
import { useRoute, AREA_NAME } from "./lib/route";
import { useBoard, attnCount } from "./lib/board";

type Me = { id: string; email: string; name: string } | null;
const NONE: Counts = { attn: 0, unread: 0, saved: 0, drafts: 0, unreadBy: {} };
const LATER: Record<string, string> = { tree: "노드 트리 — 3단계", timeline: "타임라인 — 3단계", canvas: "캔버스 — 5단계", chat: "채팅 — 2단계", unread: "읽지 않음 — 2단계", saved: "저장 — 2단계", drafts: "초안 — 2단계" };

export function App() {
  const [me, setMe] = useState<Me | undefined>(undefined), [route, go] = useRoute();
  if (location.pathname === "/device") return me ? <Device email={me.email} /> : <Gate me={me} setMe={setMe} />;
  if (location.pathname === "/sales") return me ? <Sales email={me.email} /> : <Gate me={me} setMe={setMe} />;
  if (!me) return <Gate me={me} setMe={setMe} />;
  return location.pathname === "/" ? <Home email={me.email} signed={<Signed route={route} go={go} onOut={() => setMe(null)} />} /> : <Signed route={route} go={go} onOut={() => setMe(null)} />;
}

// 「/」: 회원이면 회원 보드(우리 판 — 보드 틀이 없을 때 Worker 가 앱을 내줌), 주인이면 원래 화면
function Home({ email, signed }: { email: string; signed: ReactNode }) {
  const [member, setMember] = useState<boolean | null>(null);
  useEffect(() => { fetch("/api/me/inbox", { credentials: "include", headers: { "x-hb": "1" } }).then(r => setMember(r.ok), () => setMember(false)); }, []);
  if (member === null) return <div className="grid min-h-dvh place-items-center"><span className="g g-spin" aria-label="불러오는 중" /></div>;
  return member ? <MemberBoard email={email} /> : <>{signed}</>;
}

function Gate({ me, setMe }: { me: Me | undefined; setMe: (m: Me) => void }) {
  const load = () => fetch("/api/me", { credentials: "include" }).then(r => r.ok ? r.json() as Promise<{ user: Me }> : { user: null }).then(j => setMe(j.user), () => setMe(null));
  useEffect(() => { load(); }, []);
  if (me === undefined) return <div className="grid min-h-dvh place-items-center"><span className="g g-spin" aria-label="불러오는 중" /></div>;
  return <SignIn onDone={() => location.pathname === "/login" ? location.replace("/" + location.hash) : location.reload()} />;
}

function Signed({ route, go, onOut }: { route: ReturnType<typeof useRoute>[0]; go: ReturnType<typeof useRoute>[1]; onOut: () => void }) {
  const D = useBoard();
  const signOut = () => fetch("/api/auth/sign-out", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }).finally(onOut);   // 몸통 없는 POST 는 better-auth 가 거절 — 화면만 나가고 세션이 남았었음
  return (
    <Frame route={route} go={go} counts={{ ...NONE, attn: attnCount(D) }} onSignOut={signOut}>
      <div className="bx-later">{route.view === "chat" ? `${AREA_NAME[route.chan || "primary"]} ` : ""}{LATER[route.view]}</div>
    </Frame>
  );
}
