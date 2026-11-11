import { formatWorld } from '../../shared/clock';
import type { PlayView } from '../../shared/types';

/** 일상 피드. 내가 자리를 비운 사이에도 이 사람들의 하루는 흘렀다 */
export function Feed({ view }: { view: PlayView }) {
  const film = view.film;
  const clock = { startDow: film.startDow, startMin: film.startMin, elapsed: view.elapsed };
  const nameOf = (key: string) => film.casts.find((c) => c.key === key)?.name ?? key;
  const posts = [...view.posts].reverse();

  return (
    <section className="feed">
      <h2>피드</h2>
      {posts.length === 0 && (
        <p className="muted">아직 올라온 글이 없어. 자리를 비웠다 돌아오면 그 사이에 올라온 글이 여기 보여.</p>
      )}
      <ul>
        {posts.map((p) => (
          <li key={p.id} className="post">
            <strong>{nameOf(p.cast)}</strong>
            <span className="when">{formatWorld(clock, p.at)}</span>
            <p>{p.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
