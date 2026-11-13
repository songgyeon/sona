/* 가짜 모델. 열쇠 없이 화면과 시험을 돌릴 때 선다.
   여기 적힌 것은 대역이다. 엔진은 이 대역을 모른다. */

import type { Model, ModelCall } from './index';

export type Script = (call: ModelCall) => string | Promise<string>;

/** 대역의 답. {이름}은 건네받은 인물 카드의 첫 사람 이름으로 바뀐다 */
export const FAKE_DEFAULTS: Record<ModelCall['purpose'], string> = {
  reply: '고개를 든다.\n{이름}: "응, 듣고 있어."',
  first: '문 쪽을 본다.\n{이름}: "왔네."',
  ping: '지금 뭐 해?',
  text: '응, 봤어.\n이따 얘기해.',
  gap: '',
  check: '판정: 없음',
  aside: '',
  post: '노래 | 밤편지 | 아이유 | 문 닫고 한 번 더.',
  past: '3일 전 | 영화 | 이터널 선샤인 | 세 번째. 이번엔 끝까지 봤다.\n2일 전 | 없음\n1일 전 | 일기 | 비가 왔다. 손님이 둘뿐이었다.',
};

/** 건네받은 인물 카드에 적힌 이름들. 차례대로 */
const namesIn = (call: ModelCall): string[] => [...call.layers.cast.matchAll(/^이름: (.+)$/gm)].map((m) => m[1]!);

export function fakeModel(script?: Script): Model & { calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  return {
    id: 'fake',
    calls,
    async run(call) {
      calls.push(call);
      const raw = script ? await script(call) : FAKE_DEFAULTS[call.purpose];
      const text = raw.replaceAll('{이름}', namesIn(call)[0] ?? '');
      return { text, thinking: null, ms: 0, tokensIn: null, tokensOut: null };
    },
  };
}

/** 대역이 적는 "그 사이의 하루". 구간 밖이거나 자는 시간인 줄은 엔진이 버린다 */
const DEMO_DAY = [
  '18:30 | 일상 | 일을 마치고 집에 왔다.',
  '19:10 | 말거리 | 저녁에 뭘 먹을지 한참 골랐다.',
  '08:40 | 일상 | 일어나서 커피를 내렸다.',
].join('\n');

/** 대역이 적는 "한편". 두 사람의 이름은 받은 카드에서 읽는다 */
function demoAside(call: ModelCall): string {
  const [a = '가', b = '나'] = namesIn(call);
  return ['장소 | 늘 보던 자리', '둘이 마주 앉아 있다. 창밖이 어둡다.', `${a}: "오늘 어땠어."`, `${b}: "그냥 그랬어."`, `${a}: "그냥?"`, `${b}: "응. 그냥."`, '잠깐 말이 끊긴다.'].join('\n');
}

/** 대역이 적는 장면의 다음 대목. 캐스트가 둘이면 둘째도 한마디 거든다 */
function demoScene(call: ModelCall): string {
  const [a = '가', b] = namesIn(call);
  const out = ['장소 | 늘 보던 자리', `${a}가 고개를 든다.`, `${a}: "응, 듣고 있어."`];
  if (b) out.push(`옆에서 ${b}가 책을 덮는다.`, `${b}: "나도 들었어."`);
  out.push(`모습 | ${a}는 늘 보던 자리에 앉아 있다.`);
  return out.join('\n');
}

/** 로컬 화면에서 대화와 자리 비우기, 피드, 한편을 눌러 볼 수 있게 하는 흉내 */
export const demoScript: Script = (call) =>
  call.purpose === 'gap' ? DEMO_DAY : call.purpose === 'aside' ? demoAside(call) : call.purpose === 'reply' ? demoScene(call) : FAKE_DEFAULTS[call.purpose];
