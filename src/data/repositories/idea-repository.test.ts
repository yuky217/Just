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

/**
 * 转任务的指针 + 标签的落库往返。
 *
 * 这一层最容易静默坏掉：字段名在 TS 里叫 `convertedTaskId`、在库里叫
 * `breakdown_task_id`，中间靠 mappers 接 —— 接错了不会有任何报错，
 * 只是"转过任务的"标记在读出来之后消失，用户会以为转失败了又转一次。
 */
describe('ideaRepository 转任务指针与标签', () => {
  it('记下转成的任务 id，再读出来还在（mapper 往返）', async () => {
    const a = createIdea('做校园二手书平台');
    await ideaRepository.create(a);
    await ideaRepository.setConvertedTaskId(a.id, 'task_123');

    expect((await ideaRepository.getById(a.id))?.convertedTaskId).toBe('task_123');
  });

  it('改正文不会把已转任务的指针抹掉', async () => {
    const a = createIdea('先记一句');
    await ideaRepository.create(a);
    await ideaRepository.setConvertedTaskId(a.id, 'task_abc');

    const loaded = await ideaRepository.getById(a.id);
    expect(loaded).not.toBeNull();
    await ideaRepository.save({ ...loaded!, content: '改过的正文' });

    const again = await ideaRepository.getById(a.id);
    expect(again?.content).toBe('改过的正文');
    expect(again?.convertedTaskId).toBe('task_abc');
  });

  it('没转过任务的想法读出来是 null（不是空字符串）', async () => {
    const a = createIdea('还没转');
    await ideaRepository.create(a);
    expect((await ideaRepository.getById(a.id))?.convertedTaskId).toBeNull();
  });

  it('标签存得住、读得回', async () => {
    const a = createIdea('带标签的想法', undefined, ['工作', '灵感']);
    await ideaRepository.create(a);
    expect((await ideaRepository.getById(a.id))?.tags).toEqual(['工作', '灵感']);
  });
});

