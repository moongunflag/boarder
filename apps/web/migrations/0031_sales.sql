-- 영업 보드(사람이 쓰는 단계 보드). 번호는 임시 — 내부 저장소 번호에 맞춰 바꿈
-- 팀 = 보드 하나. 팀원이면 누구나 보고 고침(회원 보드 owner = 메일 과 따로 — 계정 구조는 그대로)
create table sales_team (
  id text primary key,                   -- st_ + 20
  name text not null,
  created_by text not null,
  created_at integer not null
);
create table sales_member (
  team text not null,
  email text not null,                   -- 소문자
  role text not null default 'member',   -- admin · member
  added_by text not null,
  at integer not null,
  primary key (team, email)
);
create index sales_member_email on sales_member(email);
-- 카드 한 장 = 잠재 고객 사무소 하나. 연락처 칸은 두지 않음(원문 링크로만)
create table sales_card (
  id text primary key,                   -- sc_ + 20
  team text not null,
  firm text not null,
  stage text not null,                   -- inquiry · contact · call · demo · proposal · contract · handoff · hold · lost
  assignee text not null,                -- 팀원 메일
  source text not null,                  -- inquiry · seminar · referral · branch
  last_at text,                          -- 마지막 연락(YYYY-MM-DD)
  last_note text not null default '',
  next text not null default '',         -- 다음 할 일
  due text,                              -- 기한(YYYY-MM-DD, 한국 날짜)
  links text not null default '[]',      -- 원문 링크 JSON
  hold_until text,                       -- 보류일 때 다시 볼 날짜
  lost_reason text not null default '',  -- 놓침일 때 이유
  ver integer not null default 1,        -- 고칠 때마다 +1(먼저 고친 사람을 덮지 않게)
  created_by text not null,
  created_at integer not null,
  updated_by text not null,
  updated_at integer not null
);
create index sales_card_team on sales_card(team, stage, due);
-- 기록 줄: 누가 · 언제 · 무엇을(바뀐 칸 [앞, 뒤])
create table sales_event (
  id integer primary key autoincrement,
  team text not null,
  card text not null,
  who text not null,
  kind text not null,                    -- create · edit · move
  data text not null default '{}',
  at integer not null
);
create index sales_event_card on sales_event(team, card, at);
