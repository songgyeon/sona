/* 화면과 서버가 같이 쓰는 모양. 여기에는 계산이 없다. */

/** 필름 — 디렉터가 쓴 것 전부. 저장할 때 통째로 한 칸에 넣는다. */
export interface Film {
  title: string;
  logline: string;
  /** 포스터 그림. 없으면 빈 글자 */
  poster: string;
  /** 장면의 컷들 */
  stills: string[];
  /** 배경. 세계가 어떤 곳인지 두세 문장 */
  setting: string;
  /** 작중 시작 요일. 0=일요일 … 6=토요일 */
  startDow: number;
  /** 작중 시작 시각. 하루 중 분(0~1439) */
  startMin: number;
  /** 이 필름이 여는 화면 */
  opens: { feed: boolean; ping: boolean };
  /** 유저가 맡아 사는 인물 */
  persona: { name: string; line: string };
  casts: Cast[];
  /** 캐스트끼리의 사이. 방향이 있다(from이 to를 어떻게 부르는가) */
  ties: Tie[];
  firstScene: FirstScene;
}

export interface Cast {
  /** 필름 안에서만 쓰는 이름표. 저장할 때 서버가 붙인다(c1, c2 …) */
  key: string;
  name: string;
  /** 얼굴 그림. 없으면 빈 글자 */
  face: string;
  /** 불리는 이름들 — 유저나 주변 사람이 이 사람을 가리킬 때 쓰는 말 */
  aliases: string[];
  /** 나(유저의 인물)에게 누구인가 */
  role: string;
  /** 이 사람이 나를 부르는 말 */
  callsUser: string;
  /** 말높이와 말버릇 한 줄 */
  speech: string;
  /** 예시 대사 2~3줄 */
  samples: string[];
  /** 자는 시간. 하루 중 분. 자정을 넘겨도 된다(from > to) */
  sleepFrom: number;
  sleepTo: number;
  /** 낮에 주로 있는 곳 */
  dayPlace: string;
}

export interface Tie {
  from: string;
  to: string;
  /** 어떤 사이인가 */
  relation: string;
  /** from이 to를 부르는 말 */
  calls: string;
}

/** 오프닝의 한 칸. 디렉터가 쌓은 순서대로 흐른다 */
export type Beat =
  /** 컷 — 이 자리부터 화면의 그림이 바뀐다 */
  | { kind: 'cut'; image: string }
  /** 지문 — 말한 사람이 없다 */
  | { kind: 'tell'; text: string }
  /** 대사 — 어느 캐스트의 말인가(cast.key) */
  | { kind: 'say'; cast: string; text: string };

export interface FirstScene {
  place: string;
  /** 오프닝. 컷·지문·대사가 순서대로. 비어 있어도 된다 */
  beats: Beat[];
  /** 어느 캐스트와의 방에서 시작하나 */
  room: string;
  /** 오프닝이 끝나면 누가 먼저 말하나. cast면 대사 모델이 오프닝에 이어 쓴다 */
  speaker: 'persona' | 'cast';
  /** 예전 필름에만 있는 첫 마디. 지금은 오프닝의 대사 칸으로 쓴다 — 새 필름에서는 늘 빈 글자다 */
  firstLine: string;
}

/* ── 플레이 ── */

/** 'persona'는 유저가 맡은 인물, 'tell'은 지문(말한 사람이 없다), 그 밖에는 캐스트의 이름표(cast.key) */
export type Speaker = 'persona' | 'tell' | string;

export interface MessageView {
  id: string;
  room: string;
  speaker: Speaker;
  text: string;
  /** 작중 시각. 시작에서 흐른 분 */
  at: number;
  kind: 'chat' | 'first' | 'ping';
  turnId: string;
}

/** 일상 피드의 글 */
export interface PostView {
  id: string;
  cast: string;
  text: string;
  at: number;
}

export interface TurnView {
  id: string;
  no: number;
  kind: 'enter' | 'say' | 'skip';
  room: string | null;
  status: 'pending' | 'done' | 'failed';
  failReason: string | null;
}

export interface PlayView {
  id: string;
  filmId: string;
  film: Film;
  /** 시작에서 흐른 작중 분 */
  elapsed: number;
  ended: boolean;
  messages: MessageView[];
  posts: PostView[];
  /** 답을 못 받은 턴이 있으면 그 턴. 화면은 '다시 받기'를 보여준다 */
  stuck: TurnView | null;
}

export interface FilmCard {
  id: string;
  title: string;
  logline: string;
  poster: string;
  castNames: string[];
  personaName: string;
  personaLine: string;
  mine: boolean;
  featured: boolean;
}

export interface PlayCard {
  id: string;
  filmId: string;
  title: string;
  logline: string;
  poster: string;
  castNames: string[];
  elapsed: number;
  startDow: number;
  startMin: number;
  ended: boolean;
  lastLine: string;
}

export interface ApiError {
  error: string;
  /** 사람이 읽는 한 줄 */
  message: string;
}
