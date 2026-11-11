import { useEffect, useState } from 'react';

/** 길 몇 개뿐이라 라우터를 따로 들이지 않는다 */
export function useRoute(): [string, (to: string) => void] {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (to: string) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history.pushState(null, '', to);
    // 길을 가르는 데는 물음표 앞까지만 쓴다. 뒤는 그 화면이 직접 읽는다
    setPath(window.location.pathname);
    window.scrollTo(0, 0);
  };

  return [path, go];
}
