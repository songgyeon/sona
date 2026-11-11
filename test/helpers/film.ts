/* 시험이 쓰는 것들. 필름은 shared/dev-film.ts의 임시 필름을 쓴다. */

import { fakeModel, type Script } from '../../worker/model/fake';
import type { Ctx } from '../../worker/engine/ctx';
import { memoryDb } from './db';

export { DEV_FILM } from '../../shared/dev-film';


/** 서로 아는 두 사람이 나오는 시험용 필름. 민아는 0시~6시, 이도현은 0시~7시에 잔다 */
export const TWO_FILM = {
  title: '시험용 — 두 사람',
  logline: '',
  setting: '작은 회사. 다들 성인이다.',
  startDow: 5,
  startMin: 16 * 60,
  opens: { feed: true, ping: true },
  persona: { name: '수아', line: '입사 2년 차' },
  casts: [
    {
      name: '민아',
      aliases: [],
      role: '같은 팀 후배',
      callsUser: '선배',
      speech: '존댓말',
      samples: [],
      sleepFrom: 0,
      sleepTo: 6 * 60,
      dayPlace: '사무실',
    },
    {
      name: '이도현',
      aliases: ['팀장님'],
      role: '팀장',
      callsUser: '수아 씨',
      speech: '존댓말',
      samples: [],
      sleepFrom: 0,
      sleepTo: 7 * 60,
      dayPlace: '사무실',
    },
  ],
  ties: [
    { from: 'c1', to: 'c2', relation: '외삼촌. 회사에서는 숨긴다', calls: '삼촌' },
    { from: 'c2', to: 'c1', relation: '조카', calls: '민아' },
  ],
  firstScene: { place: '탕비실', situation: '점심 뒤.', room: 'c1', speaker: 'persona', firstLine: '' },
};

export const VISITOR = '11111111-1111-4111-8111-111111111111';
export const OTHER_VISITOR = '22222222-2222-4222-8222-222222222222';

let seq = 0;
/** 시험마다 다른 uuid */
export function uid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

export function testCtx(script?: Script): Ctx & { model: ReturnType<typeof fakeModel>; db: ReturnType<typeof memoryDb> } {
  let t = 1_700_000_000_000;
  return {
    db: memoryDb(),
    model: fakeModel(script),
    visitor: VISITOR,
    now: () => (t += 1000),
  };
}
