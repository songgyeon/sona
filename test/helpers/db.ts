/* 시험용 저장소. 진짜 SQLite에 진짜 표를 올린다 — 배포판과 같은 문(Db)으로 선다. */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, Stmt } from '../../worker/db';
import { SCHEMA } from '../../worker/schema';

export function memoryDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  for (const sql of SCHEMA) raw.exec(sql);

  const bind = (params: unknown[]) => params.map((p) => (p === undefined ? null : p)) as SQLInputValue[];

  return {
    raw,
    async all<T>(sql: string, ...params: unknown[]) {
      return raw.prepare(sql).all(...bind(params)) as T[];
    },
    async first<T>(sql: string, ...params: unknown[]) {
      return (raw.prepare(sql).get(...bind(params)) as T | undefined) ?? null;
    },
    async run(sql: string, ...params: unknown[]) {
      raw.prepare(sql).run(...bind(params));
    },
    async batch(stmts: Stmt[]) {
      raw.exec('BEGIN');
      try {
        for (const s of stmts) raw.prepare(s.sql).run(...bind(s.params));
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
