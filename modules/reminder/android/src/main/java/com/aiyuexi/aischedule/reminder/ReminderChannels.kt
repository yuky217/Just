package com.aiyuexi.aischedule.reminder

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.os.Build

/**
 * 三档通知渠道（2026-10-13）。
 *
 * 为什么要分三档：提醒只有"响了"和"没响"两种结果是不够的 ——
 * 一条"期末论文明天 18:00 截止"和一条"该喝水了"用同一种方式弹出来，
 * 用户要么被后者烦到关掉全部通知，要么被前者漏掉。
 * 分档之后，**用户可以在系统设置里按渠道单独调声音、振动、是否横幅**，
 * 我们不做声音选择器（那是系统已有的、做得更好的东西）。
 *
 * 三档：
 * - **普通**（`reminder-normal`）：铃声 + 通知栏，不打断。绝大多数提醒走这档。
 * - **重要**（`reminder-important`）：IMPORTANCE_HIGH → 顶部横幅直接飘出来（heads-up），
 *   但仍然只是一条通知，不会盖住手上的事。
 * - **截止**（`reminder-deadline`）：IMPORTANCE_MAX + 全屏弹窗 + 闹钟分类（可穿勿扰）。
 *   这档是"错过了就来不及"的那类事，宁可打扰，也不能让人没看见。
 *
 * ⚠️ 渠道一旦建好，重要性**改不动**（系统会记住用户后来的手动调整），
 * 所以重要性在建的时候就要定对，别指望升级时改。
 */
object ReminderChannels {

  const val NORMAL = "reminder-normal"
  const val IMPORTANT = "reminder-important"
  const val DEADLINE = "reminder-deadline"

  /**
   * 档位名 → 渠道 id。档位常量定义在 `ReminderAlarm`（与 JS 侧 `reminderLevelOf`
   * 的返回值一一对应），**必须带类名引用** —— 写光秃秃的 `LEVEL_IMPORTANT` 编译不过
   * （Kotlin 的 object 成员不会自动进入作用域，2026-10-15 出包时踩到）。
   */
  fun channelFor(level: String): String = when (level) {
    ReminderAlarm.LEVEL_IMPORTANT -> IMPORTANT
    ReminderAlarm.LEVEL_DEADLINE -> DEADLINE
    else -> NORMAL
  }

  fun ensure(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return

    create(manager, NORMAL, "提醒", NotificationManager.IMPORTANCE_DEFAULT)
    create(manager, IMPORTANT, "重要提醒", NotificationManager.IMPORTANCE_HIGH)

    /*
     * 截止那档额外声明"这是闹钟"：AudioAttributes 的 USAGE_ALARM
     * 让系统在静音/勿扰下更倾向放它出声（覆盖勿扰的一半靠这里，
     * 另一半靠用户手动在系统设置里开"勿扰例外"，代码要不到那个权限）。
     */
    val deadline = NotificationChannel(DEADLINE, "截止提醒", NotificationManager.IMPORTANCE_MAX)
    deadline.description = "到点就来不及的那种事（截止、考试、赶车）"
    deadline.enableVibration(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      deadline.setSound(
        null,
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
    }
    manager.createNotificationChannel(deadline)
  }

  private fun create(
    manager: NotificationManager,
    id: String,
    name: String,
    importance: Int,
  ) {
    if (manager.getNotificationChannel(id) != null) return
    manager.createNotificationChannel(NotificationChannel(id, name, importance))
  }
}
