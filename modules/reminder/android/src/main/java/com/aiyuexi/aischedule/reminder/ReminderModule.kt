package com.aiyuexi.aischedule.reminder

import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 提醒增强的原生侧（2026-10-13）。
 *
 * 边界说在前面：**它不接管全部提醒**，只接"重要 / 截止"两档。
 * 普通提醒仍然走 expo-notifications —— 那条路已经被真机验过（包括"App 被杀后
 * 按钮依然有效"那条链），为了两件事（全屏 + 勿扰）把整条链路换掉不划算。
 *
 * 这个模块也不写数据库：到点发通知、稍后重排都是原生该干的，
 * 但"标记完成"要改任务状态，那是 JS 的活（见 `ReminderReceiver` 里的深链）。
 */
class ReminderModule : Module() {
  private val context: android.content.Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    // JS 侧用 requireOptionalNativeModule('Reminder') 找这个名字
    Name("Reminder")

    /** 建三档渠道。渠道一旦建好，重要性就改不动了 —— 所以只在第一次真正建 */
    AsyncFunction("ensureChannels") {
      ReminderChannels.ensure(context)
      true
    }

    /*
     * 排一条提醒。
     * id 由 JS 侧给（含任务 id 与这一期的时刻），撤销时靠它认。
     */
    AsyncFunction("schedule") {
      id: String,
      title: String,
      body: String,
      atMillis: Double,
      level: String,
      taskId: String,
      ->
      ReminderAlarm.schedule(context, id, title, body, atMillis.toLong(), level, taskId)
    }

    AsyncFunction("cancel") { id: String, taskId: String ->
      ReminderAlarm.cancel(context, id, taskId)
      true
    }

    /** 撤掉一条任务的全部期（改时间 / 完成 / 删除时用） */
    AsyncFunction("cancelTask") { taskId: String ->
      ReminderAlarm.cancelTask(context, taskId)
      true
    }

    AsyncFunction("cancelAll") {
      ReminderAlarm.cancelAll(context)
      true
    }

    /** 现在能不能排"精确到点"的闹钟（拿不到 = 会晚几分钟） */
    Function("canScheduleExact") { ReminderAlarm.canScheduleExact(context) }

    /*
     * 勿扰例外**只能由用户手动开**：这个权限代码要不到，只能把人送到系统设置页。
     * 所以界面上必须把话说清楚 —— "去开"而不是"已开"。
     */
    AsyncFunction("openDndSettings") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
      } else {
        null
      }
      if (intent == null) return@AsyncFunction false
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      intent.setPackage(context.packageName)
      return@AsyncFunction try {
        context.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    /** 闹钟与提醒的权限页（Android 12+ 的"精确闹钟"在那儿） */
    AsyncFunction("openAlarmSettings") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@AsyncFunction false
      val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // data 指向本应用，系统才知道要给谁开；不设的话有的 ROM 会直接退出设置页
        data = android.net.Uri.parse("package:${context.packageName}")
      }
      return@AsyncFunction try {
        context.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
  }
}
