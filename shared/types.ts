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
  opens: { feed: boolean; ping: boolean; /** 한편 — 내가 없는 자리에서 캐스트끼리 나눈 장면을 보여 주는가 */ aside: boolean };
  /** 디렉터가 세계에 덧붙인 칸 */
  extras?: Extra[];
  /** 유저가 맡아 사는 인물. 디렉터가 정해 두고, 플레이하는 사람이 자기 삶에서 고칠 수 있다.
      배역이 여럿이면 이것이 첫째 배역이다. 삶이 들고 가는 필름에서는 들어갈 때 고른 배역이다 */
  persona: Persona;
  /** 둘째 배역부터. 들어가는 사람이 배역 가운데 하나를 고른다. 삶이 들고 가는 필름에는 없다 */
  roles?: Persona[];
  casts: Cast[];
  /** 캐스트끼리의 사이. 방향이 있다(from이 to를 어떻게 부르는가) */
  ties: Tie[];
  firstScene: FirstScene;
  /** 배경 음악. 필름 안에서 처음부터 끝까지 반복해 흐른다. 올린 음악의 표. 없으면 빈 글자 */
  bgm?: string;
  /** 배경 음악 파일의 이름. 만드는 화면에 보인다 */
  bgmName?: string;
  /** 오프닝 영상. 들어가면 맨 먼저 흐른다. 없으면 null */
  reel?: Reel | null;
}

/** 오프닝 영상의 화면비: 세로(9:16), 가로(16:9), 시네마(2.39:1) */
export type ReelRatio = 'tall' | 'wide' | 'cine';
/** 컷의 움직임: 없음, 다가가기, 물러나기, 왼쪽으로, 오른쪽으로 */
export type ReelMotion = 'none' | 'in' | 'out' | 'left' | 'right';
/** 앞 컷에서 넘어오는 법: 바로, 서서히, 검은 화면 거쳐 */
export type ReelEnter = 'cut' | 'fade' | 'black';
/** 글자 모양: 제목(가운데 크게), 자막(아래), 크레딧(아래 작게) */
export type ReelStyle = 'title' | 'sub' | 'credit';

/** 오프닝 영상의 컷 하나 */
export interface ReelClip {
  kind: 'image' | 'video' | 'black';
  /** 그림이나 영상의 표. 검은 화면은 빈 글자 */
  src: string;
  /** 길이(초) */
  dur: number;
  /** 영상: 틀기 시작하는 지점(초) */
  from: number;
  motion: ReelMotion;
  enter: ReelEnter;
  /** 컷 위에 얹는 글자. 없으면 빈 글자 */
  text: string;
  style: ReelStyle;
  /** 영상의 소리를 내는가 */
  sound: boolean;
  /** 영상 파일 전체의 길이(초). 시작 지점과 길이를 고를 때 쓴다 */
  len?: number;
}

/** 오프닝 영상. 디렉터가 컷을 이어 붙여 만든다. 영상 파일로 굽지 않고, 앱이 컷을 차례로 틀어 준다 */
export interface Reel {
  ratio: ReelRatio;
  clips: ReelClip[];
  /** 음악의 표. 없으면 빈 글자 */
  music: string;
  musicName: string;
  /** 음악을 틀기 시작하는 지점(초) */
  musicFrom: number;
  /** 음악 파일 전체의 길이(초) */
  musicLen?: number;
}

/** 디렉터가 이름을 붙여 더 적은 칸 — 항목과 내용. 대사 모델에게 그대로 건넨다 */
export interface Extra {
  label: string;
  text: string;
}

export interface Persona {
  name: string;
  /** 어떤 사람인가 */
  line: string;
  /** 프로필 사진. 없으면 빈 글자 */
  face: string;
  /** 플레이하는 사람이 이름을 바꿨다면 그 전의 이름들. 캐스트가 같은 사람인 줄 알게 건넨다 */
  formerly?: string[];
  /** 디렉터가 덧붙인 칸 */
  extras?: Extra[];
  /** 유저 이름 — 켜면 들어가는 사람의 이름이 이 배역의 이름이 된다. 그때 name은 디렉터가 글에 적은 이름이다(비우면 RULES.playerName) */
  player?: boolean;
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
  /** 소개 — 프로필에 보여 주기만 하는 글. 대사 모델은 읽지 않는다 */
  intro: string;
  /** 이 사람이 나를 부르는 말 */
  callsUser: string;
  /** 말높이와 말버릇 한 줄 */
  speech: string;
  /* 아래 다섯은 적지 않아도 된다. 적으면 그 사람이 말하고 움직이는 결에 쓰인다 */
  /** 성격 */
  nature: string;
  /** 습관 — 말과 몸에 밴 버릇 */
  habit: string;
  /** 트라우마 — 스스로 설명하지 않는다 */
  trauma: string;
  /** 결핍 — 이 사람에게 비어 있는 것 */
  lack: string;
  /** 비밀 — 남에게 말하지 않는 것 */
  secret: string;
  /** 예시 대사 2~3줄 */
  samples: string[];
  /** 자는 시간. 하루 중 분. 자정을 넘겨도 된다(from > to) */
  sleepFrom: number;
  sleepTo: number;
  /** 낮에 주로 있는 곳 */
  dayPlace: string;
  /** 디렉터가 덧붙인 칸 */
  extras: Extra[];
  /** 피드에 남기는 것 가운데 켜 둔 것. 하루에 이 가운데 하나를 남기거나 안 남긴다 */
  feed: FeedKind[];
  /** 피드에 올릴 사진. 디렉터가 붙인 것만 올라간다 */
  photos: FeedPhoto[];
}

/** 피드에 남기는 것: 본 영화·드라마, 들은 노래, 일기, 사진, 검색어, 본 영상 */
export type FeedKind = 'watch' | 'song' | 'diary' | 'photo' | 'search' | 'tube';

/** 피드에 올릴 사진. about은 무슨 사진인지 — 대사 모델이 그날에 맞는 사진을 고를 때 읽는다 */
export interface FeedPhoto {
  id: string;
  about: string;
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
  /** act는 유저가 쓴 지문(speaker는 persona다). aside는 한편의 줄이다 — 그때 room은 그 장면의 이름표다 */
  kind: 'chat' | 'first' | 'ping' | 'aside' | 'act';
  turnId: string;
}

/** 한편 — 내가 없는 자리에서 캐스트 둘이 나눈 장면. 줄들은 messages에 room이 이 id인 것들이다 */
export interface AsideView {
  id: string;
  /** 작중 시각. 시작에서 흐른 분 */
  at: number;
  /** 두 사람이 있던 곳. 모르면 빈 글자 */
  place: string;
  /** 두 사람의 이름표 */
  casts: [string, string];
}

/** 일상 피드의 글 */
export interface PostView {
  id: string;
  cast: string;
  /** 한 줄로 적은 것. 예전 글(text)은 이것뿐이다 */
  text: string;
  at: number;
  /** 종류마다 화면에 놓을 것 */
  data: PostData;
}

/** 피드 글의 속. 종류마다 모양이 다르다. text는 한 줄 글(내 피드, 예전 글) */
export type PostData =
  | { kind: 'text' }
  | { kind: 'watch'; form: 'movie' | 'drama'; title: string; ep: string; note: string }
  | { kind: 'song'; title: string; artist: string; note: string }
  | { kind: 'diary'; text: string }
  | { kind: 'photo'; photo: string; note: string }
  | { kind: 'search'; queries: string[] }
  | { kind: 'tube'; items: { title: string; length: string }[] };

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
  /** 열어 둔 날이 다 찼다. 다음 날로 이으면 다시 열린다 */
  ended: boolean;
  /** 지금 몇째 날인가. 첫 하루가 1 */
  day: number;
  /** 지금 장면이 벌어지는 곳. 서버가 모르면 빈 글자 */
  place: string;
  /** 내가 만든 필름인가 */
  mine: boolean;
  messages: MessageView[];
  posts: PostView[];
  asides: AsideView[];
  /** 답을 못 받은 턴이 있으면 그 턴. 화면은 '다시 받기'를 보여준다 */
  stuck: TurnView | null;
}

/** 필름 정보 화면에서 보는 내 배역 — 이 필름에 들어가면 이 사람이 된다.
    as: 내 이름으로 들어가나(me), 디렉터가 정한 배역 이름으로 들어가나(role), 내가 따로 고친 이름인가(custom) */
export interface FilmMine {
  name: string;
  line: string;
  face: string;
  as: 'me' | 'role' | 'custom';
  /** 내 페르소나로 들어가면 그 페르소나 */
  personaId: string | null;
  /** 맡은 배역(0 = 첫째 배역). 내 페르소나로 들어가도 배역 하나를 맡는다 */
  role: number;
}

/** 내 페르소나 — 필름마다 이 가운데 하나로 들어갈 수 있다 */
export interface MyPersona {
  id: string;
  name: string;
  line: string;
  face: string;
}

/** 저장한 장면 한 자리 */
export interface SaveView {
  id: string;
  /** 그때의 작중 시각(흐른 분) */
  at: number;
  /** 그때 장면이 벌어지던 곳 */
  place: string;
  /** 그때 마지막으로 오간 말. 없으면 빈 글자 */
  line: string;
  /** 돌아가기 전에 저절로 남긴 자리 */
  auto: boolean;
  /** 저장한 때(진짜 시각, 밀리초) */
  savedAt: number;
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
  /** 비공개 필름. 만든 사람에게만 온다 */
  private: boolean;
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
  /** 만든 사람이 필름을 지웠다. 삶은 이어서 살 수 있지만 필름 정보는 없다 */
  filmGone: boolean;
}

export interface ApiError {
  error: string;
  /** 사람이 읽는 한 줄 */
  message: string;
}
