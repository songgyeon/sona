/* 가짜 모델. 열쇠 없이 화면과 시험을 돌릴 때 선다.
   여기 적힌 것은 대역이다. 엔진은 이 대역을 모른다. */

import type { Model, ModelCall } from './index';

export type Script = (call: ModelCall) => string | Promise<string>;

export const FAKE_DEFAULTS: Record<ModelCall['purpose'], string> = {
  reply: '고개를 든다.\n"응, 듣고 있어."',
  first: '문 쪽을 본다.\n"왔네."',
  // 끼지 않고 넘긴다
  join: '…',
  ping: '지금 뭐 해?',
  gap: '',
  check: '판정: 없음',
  aside: '',
};

export function fakeModel(script?: Script): Model & { calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  return {
    id: 'fake',
    calls,
    async run(call) {
      calls.push(call);
      const text = script ? await script(call) : FAKE_DEFAULTS[call.purpose];
      return { text, thinking: null, ms: 0, tokensIn: null, tokensOut: null };
    },
  };
}

/** 대역이 적는 "그 사이의 하루". 구간 밖이거나 자는 시간인 줄은 엔진이 버린다 */
const DEMO_DAY = [
  '18:30 | 일상 | 일을 마치고 집에 왔다.',
  '19:10 | 말거리 | 저녁에 뭘 먹을지 한참 골랐다.',
  '22:40 | 피드 | 오늘은 일찍 잔다',
  '08:40 | 일상 | 일어나서 커피를 내렸다.',
].join('\n');

/** 대역이 적는 "한편". 두 사람의 이름은 받은 카드에서 읽는다 */
function demoAside(call: ModelCall): string {
  const names = [...call.layers.cast.matchAll(/^이름: (.+)$/gm)].map((m) => m[1]!);
  const a = names[0] ?? '가';
  const b = names[1] ?? '나';
  return ['장소 | 늘 보던 자리', '둘이 마주 앉아 있다. 창밖이 어둡다.', `${a}: "오늘 어땠어."`, `${b}: "그냥 그랬어."`, `${a}: "그냥?"`, `${b}: "응. 그냥."`, '잠깐 말이 끊긴다.'].join('\n');
}

/** 로컬 화면에서 자리 비우기와 피드, 한편을 눌러 볼 수 있게 하는 흉내 */
export const demoScript: Script = (call) =>
  call.purpose === 'gap' ? DEMO_DAY : call.purpose === 'aside' ? demoAside(call) : call.purpose === 'join' ? '옆에서 책을 덮는다.\n"나도 들었어."' : FAKE_DEFAULTS[call.purpose];
