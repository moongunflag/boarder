-- 회원 보드 더하기(우리 판): 카드 종류(할 일 가르기) · 회원 웹 푸시 구독
alter table board_card add column kind text not null default 'decision';   -- decision · approval · question · todo
create index board_card_kind on board_card(owner, kind, state, at);
create index board_log_thread on board_log(owner, thread, at);

create table member_push (
  owner text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  ua text not null default '',
  at integer not null,
  primary key (owner, endpoint)
);
