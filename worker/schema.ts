/* 저장소의 표. 세계 상태의 원본은 여기다 — 화면은 들고 다니지 않는다.
   Worker가 처음 불릴 때 표가 없으면 스스로 만든다. 그래서 배포할 때 따로 할 일이 없다. */

import { type Db, q } from './db';

export const SCHEMA: string[] = [
  // 디렉터가 쓴 필름. 내용은 통째로 data 한 칸에 둔다
  `CREATE TABLE IF NOT EXISTS films (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    title TEXT NOT NULL,
    logline TEXT NOT NULL,
    featured INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS films_owner ON films(owner, created_at)`,

  // 한 번의 삶. 입장할 때의 필름을 사본으로 들고 있는다
  `CREATE TABLE IF NOT EXISTS plays (
    id TEXT PRIMARY KEY,
    film_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    film TEXT NOT NULL,
    start_dow INTEGER NOT NULL,
    start_min INTEGER NOT NULL,
    elapsed INTEGER NOT NULL DEFAULT 0,
    ended INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS plays_owner ON plays(owner, created_at)`,

  // 전송 1건 = 1행. 같은 전송이 두 번 들어와도 한 번만 처리한다
  `CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    play_id TEXT NOT NULL,
    turn_no INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    room TEXT,
    status TEXT NOT NULL,
    fail_reason TEXT,
    elapsed_before INTEGER NOT NULL,
    elapsed_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (play_id, turn_no),
    UNIQUE (play_id, request_id)
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    play_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    room TEXT NOT NULL,
    speaker TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS messages_play ON messages(play_id, at)`,

  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    play_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    cast_key TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS posts_play ON posts(play_id, at)`,

  // 일어난 일. 추가만 한다. known_by는 아는 사람 목록(JSON 배열)
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    play_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    text TEXT NOT NULL,
    known_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_play ON events(play_id, at)`,

  // 모델을 부른 일. 화면에는 안 보인다. 답이 이상할 때 까닭을 찾는 데 쓴다
  `CREATE TABLE IF NOT EXISTS gen_log (
    id TEXT PRIMARY KEY,
    play_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    model TEXT NOT NULL,
    layers TEXT NOT NULL,
    raw TEXT NOT NULL,
    thinking TEXT,
    accepted INTEGER NOT NULL,
    note TEXT,
    ms INTEGER NOT NULL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS gen_log_turn ON gen_log(play_id, turn_id)`,

  // 그림. 포스터, 캐스트의 얼굴, 장면의 컷
  `CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes BLOB NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  // 하루 호출 수
  `CREATE TABLE IF NOT EXISTS usage (
    day TEXT NOT NULL,
    who TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, who)
  )`,
];

let ready = false;

/** 표가 없으면 만든다. 몇 번 불러도 같다 */
export async function ensureSchema(db: Db): Promise<void> {
  if (ready) return;
  await db.batch(SCHEMA.map((sql) => q(sql)));
  ready = true;
}
