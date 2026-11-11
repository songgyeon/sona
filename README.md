# 소나

필름 한 편을 골라 그 안의 인물로 들어가 사는 앱.

- **필름 만들기** — 세계, 내가 맡을 인물, 캐스트와 서로의 사이, 첫 장면을 화면에서 쓴다.
- **저장** — 만든 필름은 내 필름에 남는다.
- **필름에 들어가기** — 방금 만든 필름에 들어가 그 인물로 말한다. 말을 보낼 때마다 작중 시간이 흐른다.
- **자리 비우기** — 떠났다가 돌아오면 그 사이 캐스트가 보낸 하루가 피드와 먼저 온 연락에 남아 있다.
- 작중 24시간이 첫 하루다.

캐스트가 한 명인 필름도, 서로 아는 여럿이 나오는 필름도 같은 화면에서 만들고 같은 코드로 돈다.

## 올리기

저장소에 올리면 Cloudflare가 `wrangler.jsonc`대로 빌드하고 배포한다. 따로 돌릴 명령은 없다.

주소를 열면 바로 필름을 만들 수 있다. 대화를 하려면 Cloudflare 대시보드에서 이 Worker의 **변수와 시크릿**에 오픈라우터 열쇠를 넣는다.

| 이름 | 무엇 |
|---|---|
| `OPENROUTER_API_KEY` | 오픈라우터 열쇠. 없으면 필름을 만들고 저장하는 데까지만 되고, 화면이 그렇다고 알려 준다 |
| `ACCESS_KEY` | 넣지 않아도 된다. 주소를 잠그고 싶을 때만 넣는다. 넣으면 주소 뒤에 `?k=열쇠`를 붙이거나 첫 화면에서 넣어야 열린다 |

어떤 모델을 부를지는 `wrangler.jsonc`의 `MODEL_ID` 한 곳에 적는다(오픈라우터의 모델 이름 그대로).
저장소(D1)는 첫 배포 때 Cloudflare가 만들고, 표는 Worker가 스스로 만든다.

## 돌려 보기

```
npm install
npm run dev        # http://127.0.0.1:8787
npm test
npm run typecheck
```

로컬에서 `.dev.vars`에 `MODEL_KIND=fake`를 적으면 오픈라우터 열쇠 없이 가짜 모델이 선다. 가짜 모델의 답은 정해진 문장이다.

## 구조

```
shared/    types.ts · rules.ts(시간과 연락의 값) · clock.ts(작중 시간)
worker/    index.ts(길) · guard.ts(열쇠, 하루 호출 수) · db.ts · schema.ts(표)
           engine/  films(필름 읽고 쓰기) · turn(입장·한 마디·다시 받기) · talk(답 받기)
                    skip(자리 비우기) · gap(그 사이의 하루) · ping(먼저 오는 연락) · store
           prompt/  system · cast · scene
           model/   index · openrouter · fake
src/       pages/ Home · Create · Play · Feed
test/      engine/*.test.ts
```

세계 상태(작중 시각, 대화, 피드)는 서버에 있다. 화면은 열쇠와 방문자 표만 들고 다닌다.
시간을 미는 것은 코드뿐이다. 모델은 문장만 쓴다.
