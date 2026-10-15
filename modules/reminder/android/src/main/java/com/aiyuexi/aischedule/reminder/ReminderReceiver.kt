package com.aiyuexi.aischedule.reminder

import android.app.Notification
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/**
 * 到点发通知（2026-10-13）。
 *
 * 这一层只做三件 exo 做不到的事：**闹钟分类**（覆盖勿扰的一半）、
 * **全屏弹窗**（截止那档）、以及**"稍后 15 分"不打开 App 就重排**。
 *
 * 两个动作按钮的分工是刻意的：
 * - 「完成」要写库（改任务状态），原生不该碰数据库 —— 所以它是**深链打开 App**，
 *   交给 JS 落库（唯一落库口仍然是 `app-store`）。
 * - 「稍后 15 分」只是"把这条提醒挪后"，原生自己排得来 —— 所以它走**广播**，
 *   排完撤掉当前通知，**完全不打断用户**（按下按钮就别弹界面）。
 *
 * ⚠️ 全屏弹窗（fullScreenIntent）只给**截止**那一档：
 * 重要的事用顶部横幅（IMPORTANCE_HIGH）已经够看了，
 * 全屏是"手机锁着、正在看视频"也要强插的那种打扰 —— 它只能留给"错过就来不及"的事。
 * 另外 Android 14 对 FSI 又加了一层限制（系统未必放行），**真机要验**。
 */
class ReminderReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_FIRE -> fire(context, intent)
      ACTION_SNOOZE -> snooze(context, intent)
    }
  }

  private fun fire(context: Context, intent: Intent) {
    val id = intent.getStringExtra(EXTRA_ID) ?: return
    val title = intent.getStringExtra(EXTRA_TITLE) ?: return
    val body = intent.getStringExtra(EXTRA_BODY) ?: ""
    val level = intent.getStringExtra(EXTRA_LEVEL) ?: ReminderAlarm.LEVEL_NORMAL
    val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: ""

    ReminderChannels.ensure(context)
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? android.app.NotificationManager
      ?: return

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, ReminderChannels.channelFor(level))
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }

    builder
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(R.drawable.ic_reminder)
      .setAutoCancel(true)
      .setContentIntent(openTaskIntent(context, taskId))
      .setStyle(Notification.BigTextStyle().bigText(body))

    if (level != ReminderAlarm.LEVEL_NORMAL) {
      // 闹钟分类：系统在勿扰下更愿意放它出声（剩下那一半要靠用户手动开例外）
      builder.setCategory(Notification.CATEGORY_ALARM)
    }
    if (level == ReminderAlarm.LEVEL_DEADLINE) {
      builder.setFullScreenIntent(openTaskIntent(context, taskId), true)
    }

    // 「完成」→ 打开 App 由 JS 完成；「稍后 15 分」→ 原生自己重排，不打开 App
    builder.addAction(0, "完成", completeIntent(context, taskId, id))
    builder.addAction(0, "稍后 15 分", snoozeIntent(context, id, title, body, level, taskId))

    manager.notify(ReminderAlarm.notificationId(id), builder.build())
  }

  /** 稍后 15 分：重排一条新的，撤掉眼前这条 —— 全程不出现界面 */
  private fun snooze(context: Context, intent: Intent) {
    val id = intent.getStringExtra(EXTRA_ID) ?: return
    val title = intent.getStringExtra(EXTRA_TITLE) ?: return
    val body = intent.getStringExtra(EXTRA_BODY) ?: ""
    val level = intent.getStringExtra(EXTRA_LEVEL) ?: ReminderAlarm.LEVEL_NORMAL
    val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: ""
    val at = System.currentTimeMillis() + SNOOZE_MINUTES * 60_000L
    if (ReminderAlarm.schedule(context, id, title, body, at, level, taskId)) {
      ReminderAlarm.cancelNotification(context, id)
    }
  }

  private fun openTaskIntent(context: Context, taskId: String): PendingIntent {
    val uri = if (taskId.isBlank()) {
      Uri.parse("aischedule://reminder-action")
    } else {
      Uri.parse("aischedule://reminder-action?taskId=$taskId&action=open")
    }
    return activityIntent(context, uri, taskId.hashCode())
  }

  private fun completeIntent(context: Context, taskId: String, id: String): PendingIntent {
    val uri = Uri.parse("aischedule://reminder-action?taskId=$taskId&action=complete&id=$id")
    return activityIntent(context, uri, (taskId + id).hashCode())
  }

  private fun activityIntent(context: Context, uri: Uri, requestCode: Int): PendingIntent {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
    return PendingIntent.getActivity(
      context,
      requestCode,
      Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName),
      flags,
    )
  }

  private fun snoozeIntent(
    context: Context,
    id: String,
    title: String,
    body: String,
    level: String,
    taskId: String,
  ): PendingIntent {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
    return PendingIntent.getBroadcast(
      context,
      (id + "snooze").hashCode(),
      Intent(context, ReminderReceiver::class.java)
        .setAction(ACTION_SNOOZE)
        .putExtra(EXTRA_ID, id)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
        .putExtra(EXTRA_LEVEL, level)
        .putExtra(EXTRA_TASK_ID, taskId),
      flags,
    )
  }

  companion object {
    private const val ACTION_FIRE = "com.aiyuexi.aischedule.reminder.FIRE"
    private const val ACTION_SNOOZE = "com.aiyuexi.aischedule.reminder.SNOOZE"

    private const val EXTRA_ID = "id"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_LEVEL = "level"
    private const val EXTRA_TASK_ID = "taskId"

    /** 与 expo 那套「稍后 15 分」同一个数：两处手感必须一致，否则用户会以为是两个功能 */
    private const val SNOOZE_MINUTES = 15L
  }
}
