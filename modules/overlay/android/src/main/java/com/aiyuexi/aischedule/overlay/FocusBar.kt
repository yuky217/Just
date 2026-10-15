package com.aiyuexi.aischedule.overlay

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale
import kotlin.math.roundToInt

/**
 * 专注时间浮条（2026-10-13）。
 *
 * 什么时候出现：专注页开着、用户退出应用（AppState → background）。
 * 什么时候消失：回到应用、或这场专注结束 —— 这两个时机都由 JS 侧给
 * （`src/app/focus.tsx`），这里只负责"画出来 / 收起来 / 每秒走字"。
 *
 * 为什么不挂前台服务（已删除的悬浮球那版挂了）：浮条只在应用退到后台之后
 * 存在，用户要么很快回来、要么这场专注结束，都是分钟级的事，一次 addView
 * 就够，不必为它常驻一条"正在运行"的通知。进程被系统回收时窗口随之消失，
 * 而会话数据在库里，本就与浮条无关。
 *
 * 窗口只包内容（WRAP_CONTENT + 顶部居中一条）：窗口每多占一像素就多吞一像素
 * 触摸 —— 这个坑悬浮球那轮踩过（MATCH_PARENT 透明容器让整屏点不动）。
 * FLAG_NOT_TOUCH_MODAL 保证浮条之外的触摸全部穿透到下层应用。
 *
 * 点浮条 = 深链回到专注页（`aischedule://focus`），与 app.json 的 scheme 一致。
 */
object FocusBar {

  private const val FOCUS_URL = "aischedule://focus"
  private const val TICK_MS = 1000L

  /** 深色暖调，对齐 CaptureDialogActivity 的 PALETTE（浮在任何应用上都要压得住） */
  private const val BAR_COLOR = 0xF21F1E1C.toInt()
  private const val BAR_TEXT = 0xFFF2F0EB.toInt()
  private const val DOT_RUNNING = 0xFF7DA85C.toInt()
  private const val DOT_PAUSED = 0xFF9C9891.toInt()

  private val handler = Handler(Looper.getMainLooper())
  private var windowManager: WindowManager? = null
  private var root: View? = null
  private var label: TextView? = null
  private var dot: View? = null
  private var ticker: Runnable? = null

  /** 本次运行的虚拟起点（epoch ms）。暂停时它无意义，看 accumulated */
  private var startedAtMs = 0L
  /** 暂停前已经攒下的时长（ms） */
  private var accumulatedMs = 0L
  private var paused = false

  @Volatile
  private var showing = false

  fun isShowing(): Boolean = showing

  /**
   * 显示（或刷新）浮条。返回有没有真的画出来。
   *
   * 已经在显示时再调一次 = 用新状态重画：JS 每次退后台都会带最新状态来，
   * 不区分"新建"和"更新"，少一条 API。
   */
  fun show(context: Context, startedAtMs: Long, accumulatedMs: Long, paused: Boolean): Boolean {
    this.startedAtMs = startedAtMs
    this.accumulatedMs = accumulatedMs
    this.paused = paused
    if (root == null && !attach(context)) return false
    showing = true
    render()
    startTicking()
    return true
  }

  fun hide() {
    stopTicking()
    val manager = windowManager
    val view = root
    windowManager = null
    root = null
    label = null
    dot = null
    showing = false
    if (manager != null && view != null) {
      try {
        manager.removeView(view)
      } catch (_: Exception) {
        // 窗口已经被摘掉（进程正在收尾），这一次没了就算了
      }
    }
  }

  // ---------------- 画 ----------------

  private fun attach(context: Context): Boolean {
    val manager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return false
    val density = context.resources.displayMetrics.density
    fun dp(v: Float): Int = (v * density).roundToInt()

    val bar = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      background = android.graphics.drawable.GradientDrawable().apply {
        shape = android.graphics.drawable.GradientDrawable.RECTANGLE
        setColor(BAR_COLOR)
        cornerRadius = dp(20f).toFloat()
      }
      elevation = dp(8f).toFloat()
      setPadding(dp(14f), dp(7f), dp(14f), dp(7f))
      // 整条可点（回到专注页）。isClickable 而不是 setOnClickListener(null)：
      // 后者是把「可点击」关掉，触摸会放行给下层应用，点浮条就变成了点别的应用。
      isClickable = true
      setOnClickListener { openFocus(context) }
    }

    val dotView = View(context).apply {
      background = android.graphics.drawable.GradientDrawable().apply {
        shape = android.graphics.drawable.GradientDrawable.OVAL
        setColor(DOT_RUNNING)
      }
    }
    val dotSize = dp(7f)
    bar.addView(
      dotView,
      LinearLayout.LayoutParams(dotSize, dotSize).apply { marginEnd = dp(7f) },
    )

    val textView = TextView(context).apply {
      setTextColor(BAR_TEXT)
      textSize = 14f
      includeFontPadding = false
    }
    bar.addView(
      textView,
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ),
    )

    val params = WindowManager.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT,
      overlayWindowType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
        or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      // LAYOUT_NO_LIMITS 让 y 可以算到状态栏里去；停的位置 = 状态栏下面一点
      y = statusBarHeight(context) + dp(8f)
    }

    return try {
      manager.addView(bar, params)
      windowManager = manager
      root = bar
      label = textView
      dot = dotView
      true
    } catch (_: Exception) {
      // 权限被撤时会抛 SecurityException。静默失败，设置页照实显示状态
      false
    }
  }

  private fun render() {
    val text = label ?: return
    text.text = if (paused) "已暂停 ${format(elapsedMs())}" else "专注 ${format(elapsedMs())}"
    // GradientDrawable 支持直接换色，不用重建背景
    dot?.background?.setTint(if (paused) DOT_PAUSED else DOT_RUNNING)
  }

  private fun startTicking() {
    stopTicking()
    val runnable = object : Runnable {
      override fun run() {
        render()
        handler.postDelayed(this, TICK_MS)
      }
    }
    ticker = runnable
    handler.postDelayed(runnable, TICK_MS)
  }

  private fun stopTicking() {
    ticker?.let { handler.removeCallbacks(it) }
    ticker = null
  }

  // ---------------- 时间 ----------------

  private fun elapsedMs(): Long =
    accumulatedMs + if (paused) 0L else (System.currentTimeMillis() - startedAtMs).coerceAtLeast(0L)

  private fun format(ms: Long): String {
    val total = ms / 1000
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val seconds = total % 60
    return if (hours > 0) {
      String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
    } else {
      String.format(Locale.US, "%02d:%02d", minutes, seconds)
    }
  }

  // ---------------- 点一下之后 ----------------

  private fun openFocus(context: Context) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(FOCUS_URL))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(intent)
      return
    } catch (_: Exception) {
      // 深链没被解析就退回"打开应用"，别让用户点了没反应
    }
    val launcher = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launcher.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(launcher)
    } catch (_: Exception) {
      // 到这里就真的没辙了，不折腾
    }
  }

  private fun overlayWindowType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

  /** 状态栏高度：浮条要停在它下面，不然会被系统条盖住 */
  private fun statusBarHeight(context: Context): Int {
    val id = context.resources.getIdentifier("status_bar_height", "dimen", "android")
    return if (id > 0) context.resources.getDimensionPixelSize(id) else 0
  }
}
