import type { Db } from '../db';
import type { Model } from '../model/index';

/** 요청 하나가 들고 다니는 것 */
export interface Ctx {
  db: Db;
  model: Model;
  /** 브라우저마다 다른 소유자. 심사자가 들어와도 남의 플레이를 밟지 않는다 */
  visitor: string;
  /** 진짜 시각(ms). 저장할 때만 쓴다 — 세계 시각은 따로 센다 */
  now: () => number;
}

/** 사람이 읽을 한 줄을 달고 나가는 실패 */
export class Fail extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
