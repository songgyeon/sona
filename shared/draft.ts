/* 필름 만들기 화면의 칸과 필름 사이를 오간다.
   계산뿐이라 화면 없이도 돌려 볼 수 있다 — 고치기는 필름을 칸으로 되돌려 놓는 데서 시작한다. */

import { FEED_KINDS } from './feed';
import { RULES } from './rules';
import type { Extra, FeedKind, FeedPhoto, Film, Reel } from './types';

/** 덧붙이는 칸 하나(항목과 내용) */
export type DraftExtra = Extra;
/** 처음에 보이는 빈 칸들 */
export const blankExtras = (): DraftExtra[] => Array.from({ length: RULES.extras.show }, () => ({ label: '', text: '' }));
/** 내용이 있는 칸만 */
const filled = (list: DraftExtra[] | undefined): DraftExtra[] => (list ?? []).filter((e) => e.text.trim().length > 0).map((e) => ({ label: e.label.trim(), text: e.text.trim() }));
/** 저장된 칸에 빈 칸을 붙여 처음 보이는 수를 채운다 */
const padded = (list: DraftExtra[] | undefined): DraftExtra[] => {
  const have = (list ?? []).map((e) => ({ label: e.label, text: e.text }));
  return have.length >= RULES.extras.show ? have : [...have, ...blankExtras().slice(have.length)];
};

/** 둘째 배역부터의 칸. 첫째 배역은 persona로 시작하는 칸들이다 */
export interface DraftRole {
  name: string;
  line: string;
  face: string;
  /** 유저 이름 — 들어가는 사람의 이름이 이 배역의 이름이 된다. 그때 name은 글에 대신 쓰는 이름이다 */
  player: boolean;
  extras: DraftExtra[];
}

export const blankRole = (): DraftRole => ({ name: '', line: '', face: '', player: false, extras: blankExtras() });

/** 「유저 이름」 배역의 이름 칸. 대신 쓰는 이름을 그대로 두었으면 비워서 보인다 */
const roleName = (r: { name: string; player?: boolean }): string => (r.player && r.name === RULES.playerName ? '' : r.name);

export interface DraftCast {
  name: string;
  face: string;
  aliases: string;
  role: string;
  /** 소개 — 프로필에 보여 주기만 한다 */
  intro: string;
  callsUser: string;
  speech: string;
  nature: string;
  habit: string;
  trauma: string;
  lack: string;
  secret: string;
  samples: string;
  sleepFrom: string;
  sleepTo: string;
  dayPlace: string;
  /** 덧붙이는 칸 */
  extras: DraftExtra[];
  /** 피드에 남기는 것 가운데 켜 둔 것 */
  feed: FeedKind[];
  /** 피드에 올릴 사진 */
  photos: FeedPhoto[];
}

/** 오프닝의 한 칸 */
export interface DraftBeat {
  /** 화면에서 칸을 구별하는 표. 저장하지 않는다 */
  id: string;
  kind: 'cut' | 'tell' | 'say';
  /** 컷의 그림 */
  image: string;
  /** 지문이나 대사 */
  text: string;
  /** 대사를 말하는 캐스트의 순서(0부터) */
  cast: number;
}

export interface Draft {
  title: string;
  logline: string;
  poster: string;
  setting: string;
  startDow: number;
  startTime: string;
  feed: boolean;
  ping: boolean;
  /** 한편 보여 주기. 캐스트가 둘 이상일 때만 뜻이 있다 */
  aside: boolean;
  personaName: string;
  personaLine: string;
  /** 내 배역의 프로필 사진 */
  personaFace: string;
  /** 내 배역의 「유저 이름」 */
  personaPlayer: boolean;
  /** 둘째 배역부터. 배역이 여럿이면 들어가는 사람이 하나를 고른다 */
  roles: DraftRole[];
  casts: DraftCast[];
  /** 「0>1」 = 첫째 캐스트가 둘째 캐스트를 */
  ties: Record<string, { relation: string; calls: string }>;
  place: string;
  /** 오프닝. 컷·지문·대사를 쌓은 순서대로 */
  beats: DraftBeat[];
  room: number;
  speaker: 'persona' | 'cast';
  /** 비공개로 개봉한다. 만든 사람만 목록에서 보고 들어간다 */
  private: boolean;
  /** 세계에 덧붙이는 칸 */
  extras: DraftExtra[];
  /** 내 배역에 덧붙이는 칸 */
  personaExtras: DraftExtra[];
  /** 배경 음악(올린 음악의 표)과 그 파일 이름 */
  bgm: string;
  bgmName: string;
  /** 오프닝 영상. 없으면 null */
  reel: Reel | null;
}

export const blankCast = (): DraftCast => ({
  name: '',
  face: '',
  aliases: '',
  role: '',
  callsUser: '',
  speech: '',
  nature: '',
  intro: '',
  habit: '',
  trauma: '',
  lack: '',
  secret: '',
  samples: '',
  sleepFrom: '00:00',
  sleepTo: '07:00',
  dayPlace: '',
  extras: blankExtras(),
  feed: [...FEED_KINDS],
  photos: [],
});

export const blankDraft = (): Draft => ({
  title: '',
  logline: '',
  poster: '',
  setting: '',
  startDow: 5,
  startTime: '16:00',
  feed: true,
  ping: true,
  aside: true,
  personaName: '',
  personaLine: '',
  personaFace: '',
  personaPlayer: false,
  roles: [],
  casts: [blankCast()],
  ties: {},
  place: '',
  beats: [],
  room: 0,
  speaker: 'cast',
  private: false,
  extras: blankExtras(),
  personaExtras: blankExtras(),
  bgm: '',
  bgmName: '',
  reel: null,
});

const cut = (id: string, image: string): DraftBeat => ({ id, kind: 'cut', image, text: '', cast: 0 });
const tell = (id: string, text: string): DraftBeat => ({ id, kind: 'tell', image: '', text, cast: 0 });
const say = (id: string, text: string, cast: number): DraftBeat => ({ id, kind: 'say', image: '', text, cast });

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const toClock = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const split = (s: string, by: RegExp): string[] =>
  s
    .split(by)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

const key = (i: number) => `c${i + 1}`;

/** 화면의 칸을 서버가 받는 필름 모양으로 바꾼다 */
export function toFilm(d: Draft): unknown {
  return {
    private: d.private,
    title: d.title,
    logline: d.logline,
    poster: d.poster,
    setting: d.setting,
    startDow: d.startDow,
    startMin: toMin(d.startTime),
    opens: { feed: d.feed, ping: d.ping, aside: d.aside },
    bgm: d.bgm,
    bgmName: d.bgmName,
    reel: d.reel && d.reel.clips.length > 0 ? d.reel : null,
    extras: filled(d.extras),
    persona: { name: d.personaName, line: d.personaLine, face: d.personaFace, extras: filled(d.personaExtras), player: d.personaPlayer },
    roles: (d.roles ?? []).map((r) => ({ name: r.name, line: r.line, face: r.face, extras: filled(r.extras), player: r.player })),
    casts: d.casts.map((c) => ({
      name: c.name,
      face: c.face,
      aliases: split(c.aliases, /[,，\n]/),
      role: c.role,
      callsUser: c.callsUser,
      speech: c.speech,
      nature: c.nature,
      intro: c.intro,
      habit: c.habit,
      trauma: c.trauma,
      lack: c.lack,
      secret: c.secret,
      samples: split(c.samples, /\n/).slice(0, 3),
      sleepFrom: toMin(c.sleepFrom),
      sleepTo: toMin(c.sleepTo),
      dayPlace: c.dayPlace,
      extras: filled(c.extras),
      feed: c.feed ?? [...FEED_KINDS],
      photos: (c.photos ?? []).filter((ph) => ph.id).map((ph) => ({ id: ph.id, about: ph.about.trim() })),
    })),
    ties: Object.entries(d.ties)
      .map(([pair, t]) => {
        const [from, to] = pair.split('>').map(Number);
        return { from: key(from ?? 0), to: key(to ?? 0), relation: t.relation, calls: t.calls, ok: (from ?? 0) < d.casts.length && (to ?? 0) < d.casts.length };
      })
      .filter((t) => t.ok && (t.relation.trim() || t.calls.trim()))
      .map(({ ok: _ok, ...t }) => t),
    firstScene: {
      place: d.place,
      // 빈 칸은 보내지 않는다
      beats: d.beats
        .filter((b) => (b.kind === 'cut' ? b.image : b.text.trim()).length > 0)
        .map((b) =>
          b.kind === 'cut'
            ? { kind: 'cut', image: b.image }
            : b.kind === 'tell'
              ? { kind: 'tell', text: b.text }
              : { kind: 'say', cast: key(Math.min(b.cast, d.casts.length - 1)), text: b.text },
        ),
      room: key(Math.min(d.room, d.casts.length - 1)),
      speaker: d.speaker,
    },
  };
}

/** 저장된 필름을 화면의 칸으로 되돌린다. 고치기는 여기서 시작한다 */
export function fromFilm(f: Film): Draft {
  const at = (k: string) => f.casts.findIndex((c) => c.key === k);
  const ties: Draft['ties'] = {};
  for (const t of f.ties) {
    const a = at(t.from);
    const b = at(t.to);
    if (a >= 0 && b >= 0) ties[`${a}>${b}`] = { relation: t.relation, calls: t.calls };
  }
  const room = Math.max(0, at(f.firstScene.room));
  const beats: DraftBeat[] = f.firstScene.beats.map((b, i) =>
    b.kind === 'cut' ? cut(`b${i}`, b.image) : b.kind === 'tell' ? tell(`b${i}`, b.text) : say(`b${i}`, b.text, Math.max(0, at(b.cast))),
  );
  let speaker = f.firstScene.speaker;
  // 예전 필름의 첫 마디는 대사 칸으로 옮긴다. 그 말은 이미 했으니, 오프닝이 끝나면 내 차례다
  if (f.firstScene.firstLine) {
    beats.push(say(`b${beats.length}`, f.firstScene.firstLine, room));
    speaker = 'persona';
  }
  // 예전 필름에 따로 걸어 둔 컷들은 오프닝 끝에 붙여 둔다. 자리는 디렉터가 옮긴다
  const hung = new Set(beats.filter((b) => b.kind === 'cut').map((b) => b.image));
  for (const still of f.stills ?? []) {
    if (!hung.has(still)) beats.push(cut(`b${beats.length}`, still));
  }
  return {
    title: f.title,
    logline: f.logline,
    poster: f.poster ?? '',
    setting: f.setting,
    startDow: f.startDow,
    startTime: toClock(f.startMin),
    feed: f.opens.feed,
    ping: f.opens.ping,
    // 캐스트가 한 명인 필름은 나중에 캐스트를 더하면 켜진 채로 시작한다
    aside: f.casts.length > 1 ? f.opens.aside === true : true,
    personaName: roleName(f.persona),
    personaLine: f.persona.line,
    personaFace: f.persona.face ?? '',
    personaPlayer: f.persona.player === true,
    roles: (f.roles ?? []).map((r) => ({ name: roleName(r), line: r.line, face: r.face ?? '', player: r.player === true, extras: padded(r.extras) })),
    extras: padded(f.extras),
    personaExtras: padded(f.persona.extras),
    bgm: f.bgm ?? '',
    bgmName: f.bgmName ?? '',
    reel: f.reel ?? null,
    casts: f.casts.map((c) => ({
      name: c.name,
      face: c.face ?? '',
      aliases: c.aliases.join(', '),
      role: c.role,
      callsUser: c.callsUser,
      speech: c.speech,
      nature: c.nature ?? '',
      intro: c.intro ?? '',
      habit: c.habit ?? '',
      trauma: c.trauma ?? '',
      lack: c.lack ?? '',
      secret: c.secret ?? '',
      samples: c.samples.join('\n'),
      sleepFrom: toClock(c.sleepFrom),
      sleepTo: toClock(c.sleepTo),
      dayPlace: c.dayPlace,
      extras: padded(c.extras),
      feed: c.feed ?? [...FEED_KINDS],
      photos: c.photos ?? [],
    })),
    ties,
    place: f.firstScene.place,
    beats,
    room,
    speaker,
    // 공개 범위는 필름의 내용이 아니다. 고치는 화면이 필름 카드에서 읽어 채운다
    private: false,
  };
}

/** 이 기기에 남겨 둔 쓰다 만 내용을 읽는다. 예전 모양(장면 글 한 덩이, 첫 마디, 따로 건 컷)이면 칸으로 옮긴다 */
export function readDraft(raw: unknown): Draft {
  const old = (raw && typeof raw === 'object' ? raw : {}) as Partial<Draft> & { stills?: string[]; situation?: string; firstLine?: string };
  const base = { ...blankDraft(), ...old };
  let beats = Array.isArray(old.beats) ? old.beats.map((b, i) => ({ ...tell(`b${i}`, ''), ...b, id: b.id || `b${i}` })) : null;
  let speaker = base.speaker;
  if (!beats) {
    beats = [];
    const stills = Array.isArray(old.stills) ? old.stills : [];
    if (stills[0]) beats.push(cut('b0', stills[0]));
    if (old.situation) beats.push(tell(`b${beats.length}`, old.situation));
    if (speaker === 'cast' && old.firstLine) {
      beats.push(say(`b${beats.length}`, old.firstLine, base.room));
      speaker = 'persona';
    }
    for (const still of stills.slice(1)) beats.push(cut(`b${beats.length}`, still));
  }
  const { stills: _stills, situation: _situation, firstLine: _firstLine, ...rest } = base as typeof base & { stills?: unknown; situation?: unknown; firstLine?: unknown };
  const roles = Array.isArray(old.roles) ? old.roles.map((r) => ({ ...blankRole(), ...r })) : [];
  return { ...rest, beats, speaker, roles, casts: base.casts.map((c) => ({ ...blankCast(), ...c })) };
}

/* ── 임시저장 ──
   만들던 필름을 이 기기에 남겨 둔다. 한 편에 한 자리씩이라 여러 편을 남길 수 있다.
   새 필름은 쓰는 대로 남고, 「내 필름」에서 골라 이어서 만든다. 개봉하면 그 자리는 비운다. */

/** 남겨 두는 곳. 브라우저의 저장소가 이 모양이다 */
export interface Store {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** 임시저장한 필름 한 편 */
export interface SavedDraft {
  id: string;
  draft: Draft;
  /** 마지막으로 남긴 때(진짜 시각, 밀리초) */
  savedAt: number;
  /** 개봉한 필름을 고치다 남긴 것이면 그 필름. 새 필름이면 없다 */
  filmId?: string;
}

/** 개봉한 필름을 고치다 남기는 자리. 필름 한 편에 한 자리다 */
export const editSlot = (filmId: string): string => `edit-${filmId}`;

/** 한 편의 자리. 뒤에 그 필름의 표가 붙는다 */
const SLOT = 'sona.draft.';
/** 한 편만 남기던 때의 자리 */
const OLD_SLOT = 'sona.draft';

/** 아무것도 적지 않은 필름인가. 남겨 둘 것이 없다.
    시작 시각이나 스위치처럼 처음부터 값이 있는 칸은 치지 않는다 */
export function isBlank(d: Draft): boolean {
  const written = [
    d.title,
    d.logline,
    d.poster,
    d.setting,
    d.personaName,
    d.personaLine,
    d.personaFace,
    ...(d.roles ?? []).flatMap((r) => [r.name, r.line, r.face, ...r.extras.flatMap((e) => [e.label, e.text])]),
    d.place,
    ...d.casts.flatMap((c) => [c.name, c.face, c.aliases, c.role, c.intro, c.callsUser, c.speech, c.nature, c.habit, c.trauma, c.lack, c.secret, c.samples, c.dayPlace]),
    ...Object.values(d.ties).flatMap((t) => [t.relation, t.calls]),
    ...[...(d.extras ?? []), ...(d.personaExtras ?? []), ...d.casts.flatMap((c) => c.extras ?? [])].flatMap((e) => [e.label, e.text]),
    ...d.casts.flatMap((c) => (c.photos ?? []).map((ph) => ph.id)),
    d.bgm ?? '',
    ...(d.reel?.clips ?? []).map((c) => c.kind),
  ];
  return d.casts.length <= 1 && d.beats.length === 0 && written.every((v) => v.trim().length === 0);
}

/** 목록에 적는 이름 */
export const draftTitle = (d: Draft): string => d.title.trim() || '제목 없는 필름';

function readSaved(id: string, raw: string | null): SavedDraft | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { draft?: unknown; savedAt?: unknown; filmId?: unknown } | null;
    if (!o || typeof o !== 'object' || !o.draft) return null;
    const one: SavedDraft = { id, draft: readDraft(o.draft), savedAt: Number(o.savedAt) || 0 };
    if (typeof o.filmId === 'string' && o.filmId) one.filmId = o.filmId;
    return one;
  } catch {
    return null;
  }
}

/** 임시저장한 필름들을 두는 선반. 저장소가 막혀 있어도 터지지 않는다 — 그때는 남지 않을 뿐이다 */
export function shelf(store: () => Store, newId: () => string, now: () => number) {
  /** 한 편만 남기던 때의 것이 있으면 지금 자리로 옮긴다. 옮기지 못하면 그대로 둔다 */
  const moveOld = (s: Store): void => {
    const raw = s.getItem(OLD_SLOT);
    if (raw === null) return;
    const draft = readDraft(JSON.parse(raw));
    if (!isBlank(draft)) s.setItem(SLOT + newId(), JSON.stringify({ draft, savedAt: now() }));
    s.removeItem(OLD_SLOT);
  };
  const open = (): Store | null => {
    try {
      const s = store();
      try {
        moveOld(s);
      } catch {
        /* 예전 것을 못 읽거나 못 옮겼다. 지우지 않고 둔다 */
      }
      return s;
    } catch {
      return null;
    }
  };

  return {
    /** 남겨 둔 필름들. 최근에 남긴 것부터 */
    list(): SavedDraft[] {
      const s = open();
      if (!s) return [];
      try {
        const out: SavedDraft[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (!k || !k.startsWith(SLOT)) continue;
          const one = readSaved(k.slice(SLOT.length), s.getItem(k));
          if (one) out.push(one);
        }
        return out.sort((a, b) => b.savedAt - a.savedAt);
      } catch {
        return [];
      }
    },

    load(id: string): SavedDraft | null {
      const s = open();
      if (!s) return null;
      try {
        return readSaved(id, s.getItem(SLOT + id));
      } catch {
        return null;
      }
    },

    /** 남긴다. 아무것도 적지 않은 필름은 남기지 않고, 남아 있던 자리도 비운다.
        filmId는 개봉한 필름을 고치다 남길 때 그 필름이다 */
    save(id: string, draft: Draft, filmId?: string): 'saved' | 'blank' | 'blocked' {
      const s = open();
      if (!s) return 'blocked';
      try {
        if (isBlank(draft)) {
          s.removeItem(SLOT + id);
          return 'blank';
        }
        s.setItem(SLOT + id, JSON.stringify(filmId ? { draft, savedAt: now(), filmId } : { draft, savedAt: now() }));
        return 'saved';
      } catch {
        return 'blocked';
      }
    },

    drop(id: string): void {
      try {
        open()?.removeItem(SLOT + id);
      } catch {
        /* 무시 */
      }
    },
  };
}
