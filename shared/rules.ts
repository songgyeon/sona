/* 규칙의 값은 여기 한 곳에 둔다. */

export const RULES = {
  /** 유저의 전송 1건이 쓰는 작중 시간(분). 인물의 답은 시간을 안 쓴다 */
  minutesPerSend: 3,
  /** 체험 길이(작중 분). 시작에서 24시간 */
  trialMinutes: 24 * 60,
  /** 하루의 경계. 새벽 5시 */
  dayBoundaryMin: 5 * 60,

  /** 자리 비우기 */
  skip: {
    short: 20,
    errand: 120,
    /** 자고 오기 → 다음 아침 이 시각 */
    wakeMin: 7 * 60,
    /** 저녁으로 → 다음에 오는 이 시각 */
    eveningMin: 19 * 60,
  },

  /** 프롬프트에 싣는 최근 대화 줄 수 */
  historyLines: 30,

  /** 먼저 오는 연락 */
  ping: {
    /** 마지막 연락에서 이만큼 지나야 먼저 말을 건다(작중 분) */
    minGapMin: 180,
    /** 한 번 자리를 비운 동안 한 사람이 먼저 거는 연락은 한 번까지 */
    perCastPerGap: 1,
    /** 먼저 걸어 볼 시각: 일어나고 이만큼 뒤, 그리고 저녁 이 시각 */
    afterWakeMin: 30,
    eveningMin: 19 * 60 + 30,
  },

  /** 자리를 비운 동안의 하루 */
  gap: {
    /** 이보다 짧게 비우면 그 사이의 일을 만들지 않는다(작중 분) */
    minSpanMin: 60,
    daily: 3,
    post: 1,
    hook: 1,
  },

  /** 하루에 모델을 부를 수 있는 횟수. 열쇠가 새도 돈이 끝없이 나가지 않게 하는 선 */
  dailyCalls: 2000,

  /** 입력 길이 */
  limits: {
    say: 400,
    title: 40,
    logline: 80,
    setting: 600,
    short: 80,
    sample: 80,
    /** 오프닝에 쓰는 글(지문과 대사)을 모두 합친 길이 */
    opening: 2000,
    /** 오프닝의 대사 한 줄 */
    line: 200,
    /** 오프닝에 쌓는 칸 수(컷·지문·대사) */
    beats: 40,
    casts: 4,
    /** 그림 한 장의 크기(바이트). 화면이 줄여서 보낸다 */
    image: 700_000,
    /** 필름 한 편에 거는 컷 수. 오프닝에 넣는 컷도 이 수까지다 */
    stills: 8,
  },
} as const;

export const DOW_NAMES = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;
