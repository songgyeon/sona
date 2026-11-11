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
    if (to === window.location.pathname) return;
    window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  };

  return [path, go];
}
