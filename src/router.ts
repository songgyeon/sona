import { useEffect, useState } from 'react';

/* 길 몇 개뿐이라 라우터를 따로 들이지 않는다.
   앱 안에서 몇 걸음 들어왔는지를 기록(history.state.d)에 적어 둔다. 「뒤로」는 들어온 길을 거슬러 간다 —
   필름을 고치다 뒤로 가면 고치러 들어온 그 화면으로. 링크로 바로 들어와 거슬러 갈 길이 없을 때만 정해 둔 곳으로 간다. */

/** 앱 안에서 몇 걸음 들어왔나. 처음 연 화면이 0 */
const depth = (): number => {
  const s = window.history.state as { d?: unknown } | null;
  return s && typeof s.d === 'number' ? s.d : 0;
};

/** 주소만 바꾼다(걸음 수는 그대로). 화면이 주소의 물음표 뒤를 지울 때 쓴다 */
export function replaceUrl(to: string): void {
  window.history.replaceState({ d: depth() }, '', to);
}

export type Go = (to: string, opts?: { replace?: boolean }) => void;

export function useRoute(): [string, Go] {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go: Go = (to, opts) => {
    if (to === window.location.pathname + window.location.search) return;
    // replace: 지금 화면을 바꿔 끼운다 — 뒤로 가면 이 화면으로 돌아오지 않는다(저장하고 나온 고치기 화면 등)
    if (opts?.replace) window.history.replaceState({ d: depth() }, '', to);
    else window.history.pushState({ d: depth() + 1 }, '', to);
    // 길을 가르는 데는 물음표 앞까지만 쓴다. 뒤는 그 화면이 직접 읽는다
    setPath(window.location.pathname);
    window.scrollTo(0, 0);
  };

  return [path, go];
}

/** 뒤로: 들어온 길을 거슬러 간다. 거슬러 갈 길이 없으면(링크로 바로 왔으면) fallback으로 */
export function goBack(go: Go, fallback: string): void {
  if (depth() > 0) window.history.back();
  else go(fallback, { replace: true });
}
