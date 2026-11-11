/* 저장소로 가는 문. 엔진은 이 모양만 알고, 뒤에 무엇이 있는지는 모른다.
   배포판은 D1, 시험은 Node 안의 SQLite가 같은 모양으로 선다. */

export interface Stmt {
  sql: string;
  params: unknown[];
}

export interface Db {
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null>;
  run(sql: string, ...params: unknown[]): Promise<void>;
  /** 전부 되거나 전부 안 된다 */
  batch(stmts: Stmt[]): Promise<void>;
}

export const q = (sql: string, ...params: unknown[]): Stmt => ({ sql, params });

export function d1(db: D1Database): Db {
  const prep = (sql: string, params: unknown[]) => db.prepare(sql).bind(...params);
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      const r = await prep(sql, params).all<T>();
      return r.results;
    },
    async first<T>(sql: string, ...params: unknown[]) {
      return (await prep(sql, params).first<T>()) ?? null;
    },
    async run(sql: string, ...params: unknown[]) {
      await prep(sql, params).run();
    },
    async batch(stmts: Stmt[]) {
      if (stmts.length === 0) return;
      await db.batch(stmts.map((s) => prep(s.sql, s.params)));
    },
  };
}

/** 같은 전송이 두 번 들어왔거나 두 요청이 같은 턴 번호를 잡았을 때 */
export function isUniqueError(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));
}

export const newId = (): string => crypto.randomUUID();
