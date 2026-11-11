import { defineConfig } from 'vitest/config';

// 시험은 Node 안에서 돈다. 엔진은 저장소와 모델을 문(Db, Model) 뒤에 두고 있어서
// 진짜 SQLite와 가짜 모델로 실제로 돌려 볼 수 있다.
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
