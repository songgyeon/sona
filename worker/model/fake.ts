/* 가짜 모델. 열쇠 없이 화면과 시험을 돌릴 때 선다.
   여기 적힌 것은 대역이다. 엔진은 이 대역을 모른다. */

import type { Model, ModelCall } from './index';

export type Script = (call: ModelCall) => string | Promise<string>;

export const FAKE_DEFAULTS: Record<ModelCall['purpose'], string> = {
  reply: '고개를 든다.\n"응, 듣고 있어."',
  first: '문 쪽을 본다.\n"왔네."',
  ping: '지금 뭐 해?',
  gap: '',
  check: '판정: 없음',
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

/** 로컬 화면에서 자리 비우기와 피드를 눌러 볼 수 있게 하는 흉내 */
export const demoScript: Script = (call) => (call.purpose === 'gap' ? DEMO_DAY : FAKE_DEFAULTS[call.purpose]);
