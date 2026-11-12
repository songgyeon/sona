/* 소리 칸 — 오프닝 영상의 음악과 배경 음악은 앱에 하나씩 둔 소리 칸으로 낸다.
   휴대폰(특히 아이폰)은 누른 그 자리에서 튼 적 없는 소리 칸으로는 소리를 못 낸다. 「필름에 들어가기」를 누르고
   필름을 불러오는 사이에 그 순간이 지나가 버려서, 오프닝 음악이 바로 안 나왔다(2026-11-12 사용자: 「음악 바로 안 나와서 최악」).
   그래서 앱을 처음 누를 때 두 소리 칸을 소리 없는 짧은 소리로 한 번 틀어 깨워 둔다. 깨운 칸은 그 뒤로 언제든 소리를 낸다. */

/** 소리 없는 아주 짧은 소리 */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

type Which = 'reel' | 'bgm';
const els: Partial<Record<Which, HTMLAudioElement>> = {};

/** 오프닝 음악(reel)과 배경 음악(bgm)의 소리 칸. 앱에 하나씩이다 */
export function soundEl(which: Which): HTMLAudioElement {
  let a = els[which];
  if (!a) {
    a = new Audio();
    a.preload = 'auto';
    els[which] = a;
  }
  return a;
}

/** 앱을 처음 누를 때 소리 칸을 깨운다. 한 번이면 된다 */
export function wakeSoundOnTouch(): void {
  let awake = false;
  const wake = () => {
    if (awake) return;
    awake = true;
    for (const w of ['reel', 'bgm'] as const) {
      const a = soundEl(w);
      // 벌써 무엇을 틀고 있는 칸은 건드리지 않는다
      if (a.getAttribute('src')) continue;
      a.src = SILENT;
      a.play()
        .then(() => {
          if (a.src === SILENT) a.pause();
        })
        .catch(() => {});
    }
    window.removeEventListener('click', wake, true);
    window.removeEventListener('touchend', wake, true);
  };
  window.addEventListener('click', wake, true);
  window.addEventListener('touchend', wake, true);
}
