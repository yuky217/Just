package com.aiyuexi.aischedule.overlay

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 入口层在 Android 上的原生能力（2026-10-13 起只剩两件）。
 *
 * 历史：先是悬浮球（自写 Service + WindowManager 画一个气泡），
 * 2026-10-13 用户拍板「悬浮球快速记改成通知栏」—— 球整套删除
 * （OverlayService.kt 已删），这里换成通知栏常驻入口；
 * 同一天又加了「专注时间浮条」，于是「显示在其他应用上层」这个授权
 * 从"为球服务"变成"为专注浮条服务"，函数名保留 canDrawOverlays。
 *
 * 为什么只有 Android：iOS 没有公开 API 允许应用在自己的窗口之外绘制，
 * 所以那边这个模块连编都不编（见 expo-module.config.json 的 platforms）。
 *
 * 边界：本模块只管"东西在不在、画不画得出来"。点完之后去哪，
 * 由深链交给应用（aischedule://capture / aischedule://focus）。
 */
class OverlayModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    // JS 侧用 requireOptionalNativeModule('Overlay') 找这个名字
    Name("Overlay")

    /*
     * 「显示在其他应用上层」授权。通知栏入口不要它（不画窗口），
     * 专注时间浮条要。跳出去之后用户授权完回来，由 JS 侧闭环
     * （设置页 AppState 回前台重探状态）。
     */
    Function("canDrawOverlays") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(context)
      } else {
        true
      }
    }

    AsyncFunction("requestPermission") {
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      activity.startActivity(
        Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}")
        )
      )
      true
    }.runOnQueue(Queues.MAIN)

    // ---------------- 通知栏入口（2026-10-11 第二批，2026-10-13 成为唯一快速记录入口） ----------------

    Function("isEntryShowing") { NotificationEntry.isShowing(context) }

    // 通知由系统代管，不需要前台服务 —— 发/撤就是 NotificationManager 的一进一出
    AsyncFunction("showEntry") {
      NotificationEntry.show(context)
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("hideEntry") {
      NotificationEntry.hide(context)
      true
    }.runOnQueue(Queues.MAIN)

    // ---------------- 专注时间浮条（2026-10-13） ----------------

    Function("isFocusBarShowing") { FocusBar.isShowing() }

    /*
     * startedAtMs / accumulatedMs / paused 三者描述"现在这一刻的专注状态"：
     * 跑着 → startedAtMs = 虚拟起点（now - 已跑时长），accumulatedMs = 0；
     * 暂停 → accumulatedMs = 已攒的时长，paused = true（startedAtMs 忽略）。
     * 原生侧每秒用它们现算，不需要 JS 每秒同步一次。
     */
    AsyncFunction("showFocusBar") { startedAtMs: Double, accumulatedMs: Double, paused: Boolean ->
      FocusBar.show(context, startedAtMs.toLong(), accumulatedMs.toLong(), paused)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("hideFocusBar") {
      FocusBar.hide()
      true
    }.runOnQueue(Queues.MAIN)
  }
}
