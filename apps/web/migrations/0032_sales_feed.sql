-- 영업 보드 기한 목록 열쇠(아침 알림을 보내는 밖 프로그램이 읽음). 값은 두지 않고 sha256 만. 번호는 임시
alter table sales_team add column feed_hash text;
alter table sales_team add column feed_by text;
alter table sales_team add column feed_at integer;
create unique index sales_team_feed on sales_team(feed_hash) where feed_hash is not null;
