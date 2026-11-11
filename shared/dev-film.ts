/* 시험과 로컬 화면에 쓰는 임시 필름. 진짜 필름은 디렉터가 「필름 만들기」에서 쓴다. */

export const DEV_FILM = {
  title: '개발용 — 동네 서점',
  logline: '금요일 오후, 새로 온 알바의 첫 주가 끝나 간다.',
  setting:
    '골목 안쪽의 작은 서점. 손님이 많지 않아서 일하는 사람끼리 금방 말을 트게 된다. 다들 성인이다.',
  startDow: 5,
  startMin: 16 * 60,
  opens: { feed: true, ping: true },
  persona: { name: '수아', line: '이번 주에 새로 온 서점 알바' },
  casts: [
    {
      name: '한서',
      aliases: ['한서 씨'],
      role: '같이 일하는 알바 선배. 서점 주인의 조카',
      callsUser: '수아 씨',
      speech: '존댓말. 짧게 말하고 농담은 한 박자 늦게 한다',
      samples: ['그건 제가 할게요.', '아, 그 책 재밌어요. 끝이 좀 그렇긴 한데.', '퇴근하고 뭐 해요.'],
      sleepFrom: 60,
      sleepTo: 8 * 60 + 30,
      dayPlace: '서점 계산대',
    },
    {
      name: '지후',
      aliases: ['지후 씨', '단골 손님'],
      role: '매일 오는 단골. 근처 대학원에 다닌다',
      callsUser: '수아 님',
      speech: '반말과 존댓말을 섞는다. 말이 많고 묻는 게 많다',
      samples: ['오늘도 그 자리 비었어요?', '아 그거 나도 읽으려고 했는데.', '근데 한서는 원래 저래.'],
      sleepFrom: 2 * 60,
      sleepTo: 10 * 60,
      dayPlace: '대학원 연구실',
    },
  ],
  ties: [
    { from: 'c1', to: 'c2', relation: '대학 선배. 오래 알았다', calls: '형' },
    { from: 'c2', to: 'c1', relation: '대학 후배. 동생처럼 챙긴다', calls: '한서' },
  ],
  firstScene: {
    place: '서점 계산대',
    situation: '손님이 끊긴 오후. 둘이 책을 정리하고 있다.',
    room: 'c1',
    speaker: 'cast',
    firstLine: '수아 씨, 그건 거기 말고 이쪽 칸이에요.',
  },
};
