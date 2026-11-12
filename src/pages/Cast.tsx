import { useEffect, useState } from 'react';
import { fillFilm } from '../../shared/roles';
import type { Film, PostView } from '../../shared/types';
import { ApiFail, api, imgUrl } from '../api';
import { FeedItem, type PostEdit, PostTools } from '../feed';
import { Back, Bubble } from '../icons';
import { Face } from '../poster';
import { Tabs } from '../tabs';
import { goBack } from '../router';

interface Loaded {
  film: Film;
  /** 살고 있는 삶에서 들어왔을 때만 있다 */
  elapsed: number | null;
  posts: PostView[];
  /** 이 필름을 만든 사람인가. 피드 글은 만든 사람만 지운다 */
  maker: boolean;
}

/** 캐스트의 프로필. 피드는 여기 있다 — 이 사람이 자기 하루에 남긴 것 */
export function Cast({ filmId, playId, castKey, go }: { filmId?: string; playId?: string; castKey: string; go: (to: string) => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = playId
      ? api.openFeed(playId).then((v): Loaded => ({ film: v.film, elapsed: v.elapsed, posts: v.posts.filter((p) => p.cast === castKey), maker: v.mine }))
      : api.film(filmId!).then((d): Loaded => ({ film: fillFilm(d.film, d.mine.name), elapsed: null, posts: [], maker: d.card.mine }));
    load.then(setData).catch((e) => setErr(e instanceof ApiFail ? e.message : '프로필을 불러오지 못했어요.'));
  }, [filmId, playId, castKey]);

  /** 피드 글을 고친다. 고친 뒤의 이 사람 글로 바꿔 놓는다 */
  const edit = async (postId: string, input: PostEdit): Promise<string | null> => {
    if (!playId) return null;
    try {
      const v = await api.editPost(playId, postId, input);
      setData((d) => (d ? { ...d, posts: v.posts.filter((p) => p.cast === castKey) } : d));
      return null;
    } catch (e) {
      return e instanceof ApiFail ? e.message : '고치지 못했어요.';
    }
  };

  /** 피드 글을 지운다. 지운 뒤의 이 사람 글로 바꿔 놓는다 */
  const drop = async (postId: string): Promise<string | null> => {
    if (!playId) return null;
    try {
      const v = await api.dropPost(playId, postId);
      setData((d) => (d ? { ...d, posts: v.posts.filter((p) => p.cast === castKey) } : d));
      return null;
    } catch (e) {
      return e instanceof ApiFail ? e.message : '지우지 못했어요.';
    }
  };

  if (!data) return <p className="center">{err || '불러오는 중'}</p>;
  const { film } = data;
  const cast = film.casts.find((c) => c.key === castKey);
  if (!cast) return <p className="center">이 필름에 없는 인물이에요.</p>;

  const cover = (film.stills ?? [])[0] ?? film.poster ?? '';
  const clock = { startDow: film.startDow, startMin: film.startMin, elapsed: data.elapsed ?? 0 };
  const posts = [...data.posts].reverse();
  /** 사진마다 필름 번호: 이 사람이 올린 사진 가운데 몇째인가 */
  const photoNo = new Map(data.posts.filter((p) => p.data.kind === 'photo').map((p, i) => [p.id, i + 1]));
  const back = playId ? `/play/${playId}` : `/film/${filmId}`;

  return (
    <main className="app tabbed">
      <div className="top">
        <button className="ico" onClick={() => goBack(go, back)} aria-label="돌아가기">
          <Back />
        </button>
      </div>

      <div className="cover grain">{cover && <img src={imgUrl(cover)} alt="" />}</div>

      <section className="who">
        <Face id={cast.face ?? ''} name={cast.name} />
        <h1 className="title">{cast.name}</h1>
        {cast.role && <p className="role">{cast.role}</p>}
        {/* 디렉터가 프로필에 보여 주려고 쓴 소개. 대사 모델은 읽지 않는다 */}
        {cast.intro && <p className="intro">{cast.intro}</p>}
        {playId && (
          <div className="acts">
            {/* 채팅은 하나다 — 이 단추는 그 채팅으로 돌아간다(캐스트마다 따로 여는 메시지 창은 없다) */}
            <button className="btn play" onClick={() => go(`/play/${playId}`)}>
              <Bubble />
              대화로 돌아가기
            </button>
          </div>
        )}
      </section>

      {film.opens.feed && (
        <section className="feed">
          <h2>피드</h2>
          {posts.length === 0 && (
            <p className="note">
              {playId ? '아직 올라온 글이 없어요.' : '필름에 들어가면 이 인물의 하루가 여기에 남아요.'}
            </p>
          )}
          {posts.map((p) => (
            <div className="postwrap" key={p.id}>
              <FeedItem post={p} clock={clock} no={photoNo.get(p.id) ?? 1} />
              {/* 캐스트의 글은 필름을 만든 사람만 고치거나 지운다 */}
              {playId && data.maker && <PostTools post={p} onSave={(input) => edit(p.id, input)} onDrop={() => drop(p.id)} />}
            </div>
          ))}
        </section>
      )}
      <Tabs path={''} go={go} />
    </main>
  );
}
