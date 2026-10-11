package com.aiyuexi.aischedule.overlay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * 通知栏常驻入口（2026-10-11 第二批）。
 *
 * 与悬浮球的关系：**并存一轮**。悬浮球是真机刚修好的形态，没有回退方案的
 * 替换不划算；设置页两个开关各管各的，真机验过通知栏方案再决定删谁。
 *
 * 为什么不需要前台服务：通知由**系统进程**代管 —— 发出去之后就算我们的
 * 进程被回收，这条通知还在通知栏里躺着。悬浮球必须前台服务是因为它要在
 * 别的应用上画窗口；通知没有这个需求，就不为它常驻一个服务（省电、
 * 也省一条状态栏里说"正在运行"的心理负担）。
 *
 * 代价有两条，都接受：
 * - **重启手机后通知会消失**，下次打开 App 时由 JS 侧按用户意愿恢复
 *   （`restoreNotifyEntryIfEnabled`）—— 和悬浮球服务的行为一致；
 * - **用户从最近任务里划掉 App**（部分系统视同强制停止）会连通知一起撤掉，
 *   同样等下次打开恢复。
 *
 * 点通知 → 弹 `CaptureDialogActivity`（透明输入框）。
 */
object NotificationEntry {

  private const val CHANNEL_ID = "capture-entry"
  private const val CHANNEL_NAME = "快速记录入口"
  private const val NOTIFICATION_ID = 4202

  fun show(context: Context) {
    val manager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "通知栏里常驻一条入口，点一下弹出输入框记一笔"
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_overlay_notification)
      .setContentTitle("记一件事")
      .setContentText("点一下，随手记一笔")
      .setContentIntent(dialogIntent(context))
      .setOngoing(true)
      .setShowWhen(false)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    try {
      manager.notify(NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // 通知权限没给（Android 13+）。JS 侧 enable 前会先要权限，
      // 这里静默失败即可 —— isShowing() 会如实报告"没在"
    }
  }

  fun hide(context: Context) {
    val manager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    manager.cancel(NOTIFICATION_ID)
  }

  fun isShowing(context: Context): Boolean {
    val manager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false
    return try {
      manager.activeNotifications.any { it.id == NOTIFICATION_ID }
    } catch (_: Exception) {
      false
    }
  }

  private fun dialogIntent(context: Context): PendingIntent =
    PendingIntent.getActivity(
      context,
      0,
      Intent(context, CaptureDialogActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}
