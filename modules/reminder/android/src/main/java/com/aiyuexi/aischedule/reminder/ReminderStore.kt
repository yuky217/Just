package com.aiyuexi.aischedule.reminder

import android.content.Context

/**
 * 提醒 id 的小账本：一条任务对应哪几期（2026-10-13）。
 *
 * 为什么要记：AlarmManager 的撤销要求 PendingIntent **一模一样**，
 * 而我们排的是"未来 7 天的每一期"（重复任务），撤销时得知道当时排了哪几个 id。
 * 光靠 taskId 推不出来（时间变了、期数变了就对不上）。
 *
 * 用 SharedPreferences 而不是 SQLite：这只是"当前排着的 id"的一份索引，
 * 进程被杀、手机重启后即使丢了，最坏的结果也只是漏撤几条（冷启动会全撤重排）。
 * 为这种数据去开一个库不值当。
 *
 * ⚠️ `getStringSet` 返回的是**内部那一份集合**，直接改它再 put 回去等于没改 ——
 * 必须先复制出一份新的（这就是下面每个方法都 `toSet()` 的原因）。
 */
object ReminderStore {

  private const val PREF = "aischedule.reminder.ids"

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREF, Context.MODE_PRIVATE)

  fun idsForTask(context: Context, taskId: String): Set<String> =
    prefs(context).getStringSet(taskId, emptySet())?.toSet() ?: emptySet()

  fun allTaskIds(context: Context): Set<String> = prefs(context).all.keys.toSet()

  fun remember(context: Context, taskId: String, id: String) {
    val current = idsForTask(context, taskId).toMutableSet()
    if (!current.add(id)) return
    prefs(context).edit().putStringSet(taskId, current).apply()
  }

  fun forget(context: Context, taskId: String, id: String) {
    val current = idsForTask(context, taskId).toMutableSet()
    if (!current.remove(id)) return
    val editor = prefs(context).edit()
    if (current.isEmpty()) editor.remove(taskId) else editor.putStringSet(taskId, current)
    editor.apply()
  }
}
