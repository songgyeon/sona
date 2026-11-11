/* 모델 자리. 엔진은 이 모양만 안다 — 어떤 모델이 서 있는지는 설정이 정한다.
   모델이 하는 일은 문장을 쓰는 것이다. 시간과 누가 무엇을 아는지는 코드가 정한다. */

/** reply 답 / first 첫 마디 / join 한자리에 있는 다른 사람이 끼는 말 / ping 먼저 건 말 / gap 그 사이의 하루 / check 한 줄 확인 / aside 한편(캐스트끼리의 장면) */
export type Purpose = 'reply' | 'first' | 'join' | 'ping' | 'gap' | 'check' | 'aside';

/** 프롬프트 세 층 */
export interface Layers {
  /** 시스템 — 모든 필름·모든 인물에 같은 글 */
  system: string;
  /** 캐릭터 — 디렉터가 쓴 인물 카드 */
  cast: string;
  /** 시나리오 — 지금 이 장면의 사실 */
  scene: string;
}

export interface ModelCall {
  purpose: Purpose;
  layers: Layers;
  /** 마지막에 놓이는 말(유저의 이번 말) */
  user: string;
  temperature: number;
  maxTokens: number;
}

export interface ModelOut {
  text: string;
  /** 사고 과정이 따로 왔으면 여기. 대사에 섞지 않는다 */
  thinking: string | null;
  ms: number;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface Model {
  /** 기록에 남는 이름 */
  id: string;
  run(call: ModelCall): Promise<ModelOut>;
}

export function systemText(l: Layers): string {
  return [l.system, l.cast, l.scene].filter((s) => s.trim().length > 0).join('\n\n');
}
