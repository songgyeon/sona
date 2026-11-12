import { useEffect, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import { RULES } from '../../shared/rules';
import type { MyPersona, PlayView } from '../../shared/types';
import { ApiFail, api } from '../api';
import { FacePick } from '../crop';
import { Back } from '../icons';
import { Card, Field } from './Create';
import { Tabs } from '../tabs';

/** 내 배역. 플레이하는 사람이 자기 삶에서 맡은 인물의 사진과 정보를 고친다.
    고친 것은 내 삶에만 적히고, 같은 필름에 다시 들어가도 이어진다. 디렉터의 필름은 그대로다 */
export function Me({ playId, go }: { playId: string; go: (to: string) => void }) {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [face, setFace] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /** 이 삶. 내 피드를 그린다 */
  const [view, setView] = useState<PlayView | null>(null);
  /** 쓰고 있는 피드 글 */
  const [post, setPost] = useState('');
  const [posting, setPosting] = useState(false);
  const [postErr, setPostErr] = useState('');

  /** 이 필름에 고른 내 페르소나. 있으면 그 페르소나를 고친다 — 그 페르소나로 들어가는 필름에 모두 적힌다 */
  const [persona, setPersona] = useState<MyPersona | null>(null);

  useEffect(() => {
    api
      .play(playId)
      .then(async (v) => {
        setView(v);
        const mine = await api
          .film(v.filmId)
          .then((d) => d.mine)
          .catch(() => null);
        const chosen = mine?.personaId ? ((await api.personas().catch(() => [])).find((p) => p.id === mine.personaId) ?? null) : null;
        setPersona(chosen);
        // 고른 페르소나면 그 페르소나에 적힌 그대로 고친다(비어 있어 배역의 것을 빌려 쓰던 칸은 빈 채로)
        setName(chosen ? chosen.name : v.film.persona.name);
        setLine(chosen ? chosen.line : v.film.persona.line);
        setFace(chosen ? chosen.face : (v.film.persona.face ?? ''));
        setReady(true);
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '내 배역을 불러오지 못했어요.'));
  }, [playId]);

  const back = () => go(`/play/${playId}`);

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      if (persona) await api.editPersona(persona.id, { name, line, face });
      else await api.setPersona(playId, { name, line, face });
      back();
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : '저장하지 못했어요.');
      setBusy(false);
    }
  };

  /** 내 피드에 올린다. 캐스트도 본다 */
  const share = async () => {
    const text = post.trim();
    if (!text || posting) return;
    setPosting(true);
    setPostErr('');
    try {
      setView(await api.postMine(playId, text));
      setPost('');
    } catch (x) {
      setPostErr(x instanceof ApiFail ? x.message : '올리지 못했어요.');
    }
    setPosting(false);
  };

  if (!ready) return <p className="center">{err || '불러오는 중'}</p>;
  const clock = view ? { startDow: view.film.startDow, startMin: view.film.startMin, elapsed: view.elapsed } : null;
  const mine = view ? [...view.posts.filter((p) => p.cast === 'persona')].reverse() : [];

  return (
    <main className="app tabbed make">
      <div className="head">
        <button className="ico" onClick={back} aria-label="돌아가기">
          <Back />
        </button>
        <b>내 배역</b>
        <div className="right">
          <button className="mini open" disabled={busy || !name.trim()} onClick={save}>
            저장
          </button>
        </div>
      </div>

      <section className="body">
        <p className="lead">{persona ? '이 필름에 고른 내 페르소나예요.' : '이 필름에서 내가 맡은 인물이에요.'}</p>
        <p className="sub">{persona ? '고친 내용은 이 페르소나로 들어가는 필름에 모두 적혀요.' : '고친 내용은 내 삶에만 적혀요.'}</p>

        <Card title="프로필">
          <div className="casthead">
            <FacePick face={face} label="내 사진 고르기" disabled={busy} onPick={setFace} />
            <Field label="이름" must count={[name.length, 20]}>
              <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          {face && (
            <p className="hint">
              <button className="textbtn" onClick={() => setFace('')}>
                사진 빼기
              </button>
            </p>
          )}
          <Field label="어떤 사람" count={[line.length, RULES.limits.persona]} hint="캐스트가 나를 이런 사람으로 알고 대해요.">
            <textarea rows={3} value={line} maxLength={RULES.limits.persona} placeholder="예) 한 학기 만에 방송부로 돌아온 사람" onChange={(e) => setLine(e.target.value)} />
          </Field>
          <p className="hint">이름을 바꾸면 필름 속 글의 이름도 함께 바뀌어요.</p>
        </Card>

        {err && (
          <p className="warn" style={{ marginTop: 20 }}>
            {err}
          </p>
        )}

        {view?.film.opens.feed && clock && (
          <Card title="내 피드" sub="올린 글은 캐스트도 봐요.">
            <Field label="새 글" count={[post.length, RULES.feed.length]}>
              <textarea rows={3} value={post} maxLength={RULES.feed.length} placeholder="예) 비 그친 줄 알았는데." onChange={(e) => setPost(e.target.value)} />
            </Field>
            {postErr && <p className="warn">{postErr}</p>}
            <button className="btn more wide" disabled={posting || !post.trim()} onClick={() => void share()}>
              {posting ? '올리는 중' : '피드에 올리기'}
            </button>
            {mine.map((p) => (
              <article className="post" key={p.id}>
                <time>{formatWorld(clock, p.at)}</time>
                <p>{p.text}</p>
              </article>
            ))}
          </Card>
        )}

        <div className="next">
          <button className="btn play" disabled={busy || !name.trim()} onClick={save}>
            저장
          </button>
        </div>
      </section>
      <Tabs path={''} go={go} />
    </main>
  );
}
