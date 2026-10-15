import { getDatabase } from '@/data/db/client';
import { periodColumns, periodFromRow, type PeriodRow } from '@/data/db/mappers';
import { TABLES } from '@/data/db/schema';
import { insertParams, insertSql, updateParams, updateSql } from '@/data/db/sql';
import { touch } from '@/data/db/touch';
import type { PeriodLog } from '@/domain/period';
import { createPeriodLog } from '@/domain/factory';
import { toDayKey } from '@/utils/datetime';

const TABLE = TABLES.periodLogs;
const LIVE = 'deleted_at IS NULL';

/**
 * 经期记录仓储。
 *
 * 一次来潮记一行；同一条"来潮"的每次记录都是独立行（不像打卡那样按天幂等）。
 * 查询自动排除软删除、写入自动更新时间戳，与全库其它仓储同一套约定。
 */
export const periodRepository = {
  /** 全部记录，按来潮日倒序（最近一次在最前） */
  async listAll(): Promise<PeriodLog[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<PeriodRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} ORDER BY start_date DESC, created_at DESC`,
    );
    return rows.map(periodFromRow);
  },

  /** 记一次来潮：startDate 是来潮当天，length 是持续天数 */
  async log(startDate: Date, length: number): Promise<PeriodLog> {
    const log = createPeriodLog(startDate, length);
    const db = await getDatabase();
    const columns = periodColumns(log);
    await db.runAsync(insertSql(TABLE, columns), insertParams(columns));
    return log;
  },

  /** 改一次记录的持续天数 / 备注 */
  async save(log: PeriodLog): Promise<PeriodLog> {
    const db = await getDatabase();
    const next = touch(log);
    const columns = periodColumns(next);
    await db.runAsync(updateSql(TABLE, columns), updateParams(columns));
    return next;
  },

  async update(id: string, patch: Partial<PeriodLog>): Promise<PeriodLog | null> {
    const current = await this.getById(id);
    if (!current) return null;
    return this.save({ ...current, ...patch, id: current.id });
  },

  async getById(id: string): Promise<PeriodLog | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<PeriodRow>(`SELECT * FROM ${TABLE} WHERE id = ? AND ${LIVE}`, [
      id,
    ]);
    return row ? periodFromRow(row) : null;
  },

  /** 软删一条记录（撤销"记错了"）；数据不物理删，重开功能还在 */
  async softDelete(id: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await db.runAsync(`UPDATE ${TABLE} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      now,
      now,
      id,
    ]);
  },

  /**
   * 今天是否已经记过来潮（按日去重，避免一天点两次记出两条）。
   * 同一天再点"记今天"走这个判定返回已存在的那条，而不是新插一条。
   */
  async getByDay(day: Date = new Date()): Promise<PeriodLog | null> {
    const key = toDayKey(day);
    const db = await getDatabase();
    const row = await db.getFirstAsync<PeriodRow>(
      `SELECT * FROM ${TABLE} WHERE ${LIVE} AND start_date = ?`,
      [key],
    );
    return row ? periodFromRow(row) : null;
  },
};
