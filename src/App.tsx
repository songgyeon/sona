import { type FormEvent, useEffect, useState } from 'react';
import { ApiFail, api, getKey, setKey } from './api';
import { Create } from './pages/Create';
import { Home } from './pages/Home';
import { Play } from './pages/Play';
import { useRoute } from './router';

type Gate = 'checking' | 'open' | 'locked';

/** 심사자에게 주는 링크에는 열쇠가 들어 있다(?k=…). 받아서 기억하고 주소에서는 지운다 */
function takeKeyFromUrl(): void {
  const url = new URL(window.location.href);
  const k = url.searchParams.get('k');
  if (!k) return;
  setKey(k);
  url.searchParams.delete('k');
  window.history.replaceState(null, '', url.pathname + url.search);
}

export function App() {
  const [path, go] = useRoute();
  const [gate, setGate] = useState<Gate>('checking');
  const [why, setWhy] = useState('');
  const [fake, setFake] = useState(false);
  const [modelReady, setModelReady] = useState(true);

  const check = async () => {
    if (!getKey()) {
      setGate('locked');
      return;
    }
    setGate('checking');
    try {
      const r = await api.key();
      setFake(r.fake);
      setModelReady(r.modelReady);
      setGate('open');
    } catch (e) {
      setWhy(e instanceof ApiFail ? e.message : '열쇠를 확인하지 못했어.');
      setGate('locked');
    }
  };

  useEffect(() => {
    takeKeyFromUrl();
    void check();
  }, []);

  if (gate === 'checking') return <p className="center muted">여는 중…</p>;
  if (gate === 'locked') return <KeyGate why={why} onSubmit={check} />;

  const play = /^\/play\/([0-9a-f-]{36})$/.exec(path);
  if (play) return <Play playId={play[1]!} go={go} />;
  if (path === '/create') return <Create go={go} />;
  return <Home go={go} fake={fake} modelReady={modelReady} />;
}

function KeyGate({ why, onSubmit }: { why: string; onSubmit: () => void }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setKey(value);
    onSubmit();
  };
  return (
    <main className="gate">
      <h1>소나</h1>
      <p className="muted">필름 한 편을 골라 그 안에서 산다.</p>
      <form onSubmit={submit}>
        <label htmlFor="key">열쇠</label>
        <input
          id="key"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="받은 열쇠를 넣어 줘"
        />
        <button type="submit">열기</button>
      </form>
      {why && <p className="warn">{why}</p>}
    </main>
  );
}
