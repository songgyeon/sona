/* 필름 만들기 화면의 칸과 필름 사이를 오간다.
   계산뿐이라 화면 없이도 돌려 볼 수 있다 — 고치기는 필름을 칸으로 되돌려 놓는 데서 시작한다. */

import type { Film } from './types';

export interface DraftCast {
  name: string;
  face: string;
  aliases: string;
  role: string;
  callsUser: string;
  speech: string;
  samples: string;
  sleepFrom: string;
  sleepTo: string;
  dayPlace: string;
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
  casts: DraftCast[];
  /** 「0>1」 = 첫째 캐스트가 둘째 캐스트를 */
  ties: Record<string, { relation: string; calls: string }>;
  place: string;
  /** 오프닝. 컷·지문·대사를 쌓은 순서대로 */
  beats: DraftBeat[];
  room: number;
  speaker: 'persona' | 'cast';
}

export const blankCast = (): DraftCast => ({
  name: '',
  face: '',
  aliases: '',
  role: '',
  callsUser: '',
  speech: '',
  samples: '',
  sleepFrom: '00:00',
  sleepTo: '07:00',
  dayPlace: '',
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
  casts: [blankCast()],
  ties: {},
  place: '',
  beats: [],
  room: 0,
  speaker: 'cast',
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
    title: d.title,
    logline: d.logline,
    poster: d.poster,
    setting: d.setting,
    startDow: d.startDow,
    startMin: toMin(d.startTime),
    opens: { feed: d.feed, ping: d.ping, aside: d.aside },
    persona: { name: d.personaName, line: d.personaLine },
    casts: d.casts.map((c) => ({
      name: c.name,
      face: c.face,
      aliases: split(c.aliases, /[,，\n]/),
      role: c.role,
      callsUser: c.callsUser,
      speech: c.speech,
      samples: split(c.samples, /\n/).slice(0, 3),
      sleepFrom: toMin(c.sleepFrom),
      sleepTo: toMin(c.sleepTo),
      dayPlace: c.dayPlace,
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
    personaName: f.persona.name,
    personaLine: f.persona.line,
    casts: f.casts.map((c) => ({
      name: c.name,
      face: c.face ?? '',
      aliases: c.aliases.join(', '),
      role: c.role,
      callsUser: c.callsUser,
      speech: c.speech,
      samples: c.samples.join('\n'),
      sleepFrom: toClock(c.sleepFrom),
      sleepTo: toClock(c.sleepTo),
      dayPlace: c.dayPlace,
    })),
    ties,
    place: f.firstScene.place,
    beats,
    room,
    speaker,
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
  return { ...rest, beats, speaker, casts: base.casts.map((c) => ({ ...blankCast(), ...c })) };
}
