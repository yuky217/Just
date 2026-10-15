package com.aiyuexi.aischedule.reminder

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.security.MessageDigest

/**
 * 提醒的排与撤（2026-10-13）。
 *
 * 为什么这一套要自己写而不是继续用 expo-notifications：
 * expo 那套拿不到两件事 —— **全屏弹窗**（fullScreenIntent）和**闹钟分类**
 * （CATEGORY_ALARM，覆盖勿扰的一半）。它们只在发送通知那一刻能设，
 * 而 expo 的通知是由它的 NotificationsService 发的，我们插不进去。
 * 所以要"截止提醒必须被看见"，就得自己排、自己发。
 *
 * ⚠️ 于是有了**两条链路并存**的代价，这里把边界钉死：
 * - **普通提醒仍然走 expo**（那条路已经被真机与"被杀后按钮"验过，别动它）；
 * - 只有"重要 / 截止"两档走这里。
 * 分流口径在 JS 侧 `domain/reminder.reminderLevelOf`，原生只认 level 这个名字。
 *
 * 撤销靠 `ReminderStore` 记的 taskId → id 列表：AlarmManager 的 PendingIntent
 * 得一模一样才能撤掉，而"这条任务排过哪几期"只有我们自己知道。
 */
object ReminderAlarm {

  /** 档位：与 JS 侧 `reminderLevelOf` 的返回值一一对应 */
  const val LEVEL_NORMAL = "normal"
  const val LEVEL_IMPORTANT = "important"
  const val LEVEL_DEADLINE = "deadline"

  private const val ACTION_FIRE = "com.aiyuexi.aischedule.reminder.FIRE"
  private const val EXTRA_ID = "id"
  private const val EXTRA_TITLE = "title"
  private const val EXTRA_BODY = "body"
  private const val EXTRA_LEVEL = "level"
  private const val EXTRA_TASK_ID = "taskId"

  fun schedule(
    context: Context,
    id: String,
    title: String,
    body: String,
    atMillis: Long,
    level: String,
    taskId: String,
  ): Boolean {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return false
    val intent = fireIntent(context, id, title, body, level, taskId)
    val pending = pendingFor(context, intent)
    return try {
      if (canScheduleExact(context)) {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending)
      } else {
        /*
         * 降级：不精确闹钟。最多晚几分钟（系统会把它和别的唤醒对齐省电）。
         * **晚几分钟也比不响好** —— 提醒的意义是"别忘了"，不是"精确到秒"。
         */
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending)
      }
      ReminderStore.remember(context, taskId, id)
      true
    } catch (_: SecurityException) {
      // 精确闹钟权限被拒（Android 14 常见）：直接退到不精确的再试一次
      try {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending)
        ReminderStore.remember(context, taskId, id)
        true
      } catch (_: Exception) {
        false
      }
    } catch (_: Exception) {
      false
    }
  }

  fun cancel(context: Context, id: String, taskId: String) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
    manager?.cancel(
      pendingFor(context, fireIntent(context, id, "", "", LEVEL_NORMAL, taskId)),
    )
    ReminderStore.forget(context, taskId, id)
    cancelNotification(context, id)
  }

  /** 撤掉一条任务的**全部**期 —— 改时间/完成/删除时用它 */
  fun cancelTask(context: Context, taskId: String) {
    for (id in ReminderStore.idsForTask(context, taskId)) {
      cancel(context, id, taskId)
    }
  }

  fun cancelAll(context: Context) {
    for (taskId in ReminderStore.allTaskIds(context)) cancelTask(context, taskId)
  }

  /**
   * 能不能用"精确"闹钟。
   *
   * Android 12+ 要 SCHEDULE_EXACT_ALARM，Android 14 起普通应用默认拿不到。
   * 界面上要如实告诉用户"现在是不精确模式"，别让他以为到点一定会响。
   */
  fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val manager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
    return manager?.canScheduleExactAlarms() == true
  }

  /** 通知 id：由提醒 id 稳定算出来（同一条提醒撤通知时得认得出来） */
  fun notificationId(reminderId: String): Int =
    runCatching {
      val digest = MessageDigest.getInstance("MD5").digest(reminderId.toByteArray())
      val value = digest.take(4)
        .fold(0) { acc, byte -> (acc shl 8) or (byte.toInt() and 0xFF) }
      (value and Int.MAX_VALUE) % 2_000_000_000
    }.getOrDefault(reminderId.hashCode() and Int.MAX_VALUE)

  internal fun cancelNotification(context: Context, reminderId: String) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? android.app.NotificationManager
    manager?.cancel(notificationId(reminderId))
  }

  private fun fireIntent(
    context: Context,
    id: String,
    title: String,
    body: String,
    level: String,
    taskId: String,
  ): Intent = Intent(context, ReminderReceiver::class.java)
    .setAction(ACTION_FIRE)
    // ⚠️ 用 data 区分不同提醒：只靠 extras 的话 PendingIntent 会被判成"同一个"，
    // 第二条提醒会把第一条的时间覆盖掉（filterEquals 不看 extras）
    .setData(Uri.parse("aischedule-reminder://$id"))
    .putExtra(EXTRA_ID, id)
    .putExtra(EXTRA_TITLE, title)
    .putExtra(EXTRA_BODY, body)
    .putExtra(EXTRA_LEVEL, level)
    .putExtra(EXTRA_TASK_ID, taskId)

  private fun pendingFor(context: Context, intent: Intent): PendingIntent {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
    return PendingIntent.getBroadcast(context, intent.data?.hashCode() ?: 0, intent, flags)
  }
}
