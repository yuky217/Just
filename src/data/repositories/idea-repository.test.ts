/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapDatabase, type BootstrapDb, type SqlParams } from '@/data/db/bootstrap';
import { createIdea } from '@/domain/factory';

import { ideaRepository } from './idea-repository';

vi.mock('@/data/db/client', () => ({
  // 仓储在这一层只会用到 getDatabase；真正连的是下面 beforeEach 塞进来的内存库
  getDatabase: () => Promise.resolve((globalThis as { __testDb?: unknown }).__testDb),
}));

interface TestDb extends BootstrapDb {
  getAllAsync<T>(source: string, params?: SqlParams): Promise<T[]>;
}

function memoryDb(): { db: DatabaseSync; adapter: TestDb } {
  const db = new DatabaseSync(':memory:');
  const adapter: TestDb = {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    getFirstAsync: async <T>(sql: string, params: SqlParams) =>
      (db.prepare(sql).get(...params) ?? null) as T | null,
    getAllAsync: async <T>(sql: string, params: SqlParams = []) =>
      db.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, params: SqlParams) => db.prepare(sql).run(...params),
  };
  return { db, adapter };
}

beforeEach(async () => {
  const { adapter } = memoryDb();
  await bootstrapDatabase(adapter);
  (globalThis as { __testDb?: unknown }).__testDb = adapter;
});

describe('ideaRepository 批量删除与撤销', () => {
  it('批量软删后，这些想法从主列表消失、但行还在库里', async () => {
    const a = createIdea('给妈打电话');
    const b = createIdea('读《设计心理学》');
    await ideaRepository.create(a);
    await ideaRepository.create(b);

    await ideaRepository.softDeleteMany([a.id, b.id]);

    // 主列表捞不到（listActive 带 deleted_at IS NULL 过滤）
    expect((await ideaRepository.listActive()).some((i) => i.id === a.id)).toBe(false);
    expect((await ideaRepository.listActive()).some((i) => i.id === b.id)).toBe(false);
  });

  it('撤销整批删除后，想法回到主列表', async () => {
    const a = createIdea('换灯泡');
    const b = createIdea('预约体检');
    await ideaRepository.create(a);
    await ideaRepository.create(b);

    await ideaRepository.softDeleteMany([a.id, b.id]);
    await ideaRepository.restoreMany([a.id, b.id]);

    const back = await ideaRepository.listActive();
    expect(back.some((i) => i.id === a.id)).toBe(true);
    expect(back.some((i) => i.id === b.id)).toBe(true);
  });

  it('已归档的想法不该被 listActive 误捞回来', async () => {
    const a = createIdea('归档这条');
    await ideaRepository.create(a);
    await ideaRepository.archive(a.id);

    expect((await ideaRepository.listActive()).some((i) => i.id === a.id)).toBe(false);
    // 但归档箱能找到它
    expect((await ideaRepository.listArchived()).some((i) => i.id === a.id)).toBe(true);
  });
});
