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

export interface Draft {
  title: string;
  logline: string;
  poster: string;
  stills: string[];
  setting: string;
  startDow: number;
  startTime: string;
  feed: boolean;
  ping: boolean;
  personaName: string;
  personaLine: string;
  casts: DraftCast[];
  /** 「0>1」 = 첫째 캐스트가 둘째 캐스트를 */
  ties: Record<string, { relation: string; calls: string }>;
  place: string;
  situation: string;
  room: number;
  speaker: 'persona' | 'cast';
  firstLine: string;
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
  stills: [],
  setting: '',
  startDow: 5,
  startTime: '16:00',
  feed: true,
  ping: true,
  personaName: '',
  personaLine: '',
  casts: [blankCast()],
  ties: {},
  place: '',
  situation: '',
  room: 0,
  speaker: 'cast',
  firstLine: '',
});

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
    stills: d.stills,
    setting: d.setting,
    startDow: d.startDow,
    startMin: toMin(d.startTime),
    opens: { feed: d.feed, ping: d.ping },
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
      situation: d.situation,
      room: key(Math.min(d.room, d.casts.length - 1)),
      speaker: d.speaker,
      firstLine: d.speaker === 'cast' ? d.firstLine : '',
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
  return {
    title: f.title,
    logline: f.logline,
    poster: f.poster ?? '',
    stills: f.stills ?? [],
    setting: f.setting,
    startDow: f.startDow,
    startTime: toClock(f.startMin),
    feed: f.opens.feed,
    ping: f.opens.ping,
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
    situation: f.firstScene.situation,
    room: Math.max(0, at(f.firstScene.room)),
    speaker: f.firstScene.speaker,
    firstLine: f.firstScene.firstLine,
  };
}
