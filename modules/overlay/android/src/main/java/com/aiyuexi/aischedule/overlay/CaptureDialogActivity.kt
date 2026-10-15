package com.aiyuexi.aischedule.overlay

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.net.URLEncoder
import kotlin.math.roundToInt

/**
 * 透明弹窗输入 —— 通知栏「记一件事」点开后的那个框。
 *
 * 为什么是 Activity 而不是 TYPE_APPLICATION_OVERLAY 窗口：悬浮球那一轮
 * 已经在 WindowManager 上栽过一次（MATCH_PARENT 吞掉整屏触摸）。
 * Activity 由系统窗口栈管理 —— 点外面/按返回就是关闭，键盘自己顶卡片，
 * 这两件事都不用我们手写，也就没有第二次踩同一个坑的机会。
 *
 * 「不打断当前 App」的边界要说清楚：
 * - **输入阶段**：本 Activity 的主题全透明，下面一层窗口正好是用户刚才那个应用
 *   —— 视觉上像"浮在原应用上"，输入完即走；
 * - **提交之后**：走深链打开 JUST 的记录页落库（唯一落库口 `quickCapture` 不动），
 *   这一刻才会真正切走 —— 落库要过 JS 解析，原生侧复刻不了它，也不该复刻。
 *
 * 语音输入（2026-10-13）：麦克风按钮弹系统自带的识别界面
 * （RecognizerIntent，不依赖 Google 服务），识别回来的文字**追加**进输入框 ——
 * 用户可能已经打了一半，覆盖他就白打了。华为/鸿蒙上只要有一个认
 * ACTION_RECOGNIZE_SPEECH 的组件就能用；一台都没有就 Toast 说一声。
 *
 * 系统分享（2026-10-13 同批）：分享一段文字进来时由 `ShareEntryActivity` 转发到本页，
 * 文字**预填进输入框**、标题改成"记下分享的内容"。不直接落库 —— 分享过来的常常是
 * 一整段（通知、聊天记录），标题该取哪一行得让人看一眼；直接偷偷记下，
 * 用户回头在待办里看见一条两百字的任务，只会觉得这软件自作主张。
 *
 * UI 全部代码手写（没有 res/layout）：一个模块内的小弹窗，XML 布局反而多一层间接。
 * 配色对齐 `src/widget/widgets.tsx` 的 PALETTE（暖调近黑近白）。
 */
class CaptureDialogActivity : Activity() {

  private lateinit var edit: EditText

  /** 这次是不是从"系统分享"进来的 —— 决定标题与落库时的 source */
  private var fromShare: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val density = resources.displayMetrics.density
    fun dp(v: Float): Int = (v * density).roundToInt()

    val dark =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    val cardColor = if (dark) CARD_DARK else CARD_LIGHT
    val textColor = if (dark) TEXT_DARK else TEXT_LIGHT
    val secondaryColor = if (dark) SECONDARY_DARK else SECONDARY_LIGHT
    val fieldColor = if (dark) FIELD_DARK else FIELD_LIGHT

    // 外面一圈半透明黑：点一下就是取消（跟系统对话框一个脾气）
    val root = FrameLayout(this).apply { setBackgroundColor(0x59000000) }
    root.setOnClickListener { finish() }

    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawableCompat.rounded(cardColor, dp(20f))
      setPadding(dp(20f), dp(18f), dp(20f), dp(16f))
      // 吞掉卡片上的点击，别让"点输入框"变成"点外面关掉"。
      // ⚠️ 用 isClickable 而不是 setOnClickListener(null)：后者是把「可点击」**关掉**，
      // 卡片会放行触摸给外层的 root，点一下卡片就关窗（本意正好相反）。
      isClickable = true
    }

    /*
     * 分享进来的先读出来：标题跟着来源变，文字预填。
     * （放在建 title 之前读，省得下面两处各读一遍 intent）
     */
    fromShare = intent?.getBooleanExtra(EXTRA_FROM_SHARE, false) ?: false
    val preset = intent?.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()

    val title = TextView(this).apply {
      text = if (fromShare) "记下分享的内容" else "记一件事"
      setTextColor(textColor)
      textSize = 15f
      includeFontPadding = false
    }
    card.addView(
      title,
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ),
    )

    edit = EditText(this).apply {
      hint = "比如：明天下午三点交报告"
      setHintTextColor(secondaryColor)
      setTextColor(textColor)
      textSize = 16f
      // 单行 + 完成（IME DONE）= 提交，跟 App 内记录输入条同一个手感；
      // 多行的话软键盘的「完成」只插换行，提交就得非点按钮不可
      setSingleLine(true)
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      imeOptions = EditorInfo.IME_ACTION_DONE
      background = GradientDrawableCompat.rounded(fieldColor, dp(12f))
      setPadding(dp(12f), dp(10f), dp(12f), dp(10f))
    }
    edit.setOnEditorActionListener { _, actionId, _ ->
      if (actionId == EditorInfo.IME_ACTION_DONE) {
        submit()
        true
      } else {
        false
      }
    }
    card.addView(
      edit,
      LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        .apply { topMargin = dp(14f) },
    )

    // 麦克风 + 记下来：一行排完，别为语音单起一行（弹窗本来就占屏，能省一行是一行）
    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }

    val mic = ImageView(this).apply {
      setImageResource(R.drawable.ic_mic)
      setColorFilter(textColor)
      scaleType = ImageView.ScaleType.FIT_CENTER
      background = GradientDrawableCompat.rounded(fieldColor, dp(12f))
      val pad = dp(11f)
      setPadding(pad, pad, pad, pad)
      contentDescription = "语音输入"
      setOnClickListener { startVoice() }
    }
    actions.addView(mic, LinearLayout.LayoutParams(dp(44f), dp(44f)))

    val submitButton = TextView(this).apply {
      text = "记下来"
      gravity = Gravity.CENTER
      setTextColor(cardColor)
      textSize = 15f
      background = GradientDrawableCompat.rounded(textColor, dp(12f))
      setPadding(0, dp(10f), 0, dp(10f))
      setOnClickListener { submit() }
    }
    actions.addView(
      submitButton,
      LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        .apply { marginStart = dp(8f) },
    )

    card.addView(
      actions,
      LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        .apply { topMargin = dp(14f) },
    )

    val margin = dp(28f)
    root.addView(
      card,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ).apply {
        gravity = Gravity.CENTER
        leftMargin = margin
        rightMargin = margin
      },
    )
    setContentView(root)

    // 分享进来的文字预填好，光标放到末尾 —— 他要的是"改一下再记"，不是重打一遍
    if (preset.isNotEmpty()) {
      edit.setText(preset)
      edit.setSelection(preset.length)
    }

    // 不弹键盘的话用户还得先点一下输入框 —— 弹窗的意义就是直接打字
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
    edit.post {
      edit.requestFocus()
      val imm = getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  /**
   * 提交 = 深链进记录页。
   *
   * 文本要 URL 编码：标题里什么字都可能有（"？"、空格、&）。
   * scheme 必须与 app.json 的 `scheme` 一致；参数名与 `app/capture.tsx` 的
   * useLocalSearchParams 对应（text = 预填内容，auto = 拿到就提交）。
   */
  private fun submit() {
    val text = edit.text.toString().trim()
    finish()
    if (text.isEmpty()) return
    val encoded = try {
      URLEncoder.encode(text, "UTF-8")
    } catch (_: Exception) {
      return // 编码都失败就别再折腾了；用户输入没丢，弹窗里重开就是
    }
    // 来源也带上：分享进来的那条，库里记 source=share（回收站/统计要能分清它是怎么来的）
    val source = if (fromShare) "&src=share" else ""
    val intent =
      Intent(Intent.ACTION_VIEW, Uri.parse("$CAPTURE_URL?text=$encoded&auto=1$source"))
        .setPackage(packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      startActivity(intent)
    } catch (_: Exception) {
      // 深链没被解析：至少弹窗已经收好，不会留下一个卡住的空壳
    }
  }

  /**
   * 弹系统语音识别。结果走 [onActivityResult] 回来 —— **不 finish**，
   * 说完回来文字已经在输入框里，接着按「记下来」就行，不用重开弹窗。
   */
  private fun startVoice() {
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
      putExtra(RecognizerIntent.EXTRA_PROMPT, "说话就行")
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }
    try {
      startActivityForResult(intent, REQUEST_SPEECH)
    } catch (_: ActivityNotFoundException) {
      Toast.makeText(this, "这台设备没有可用的语音识别", Toast.LENGTH_SHORT).show()
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_SPEECH) return
    if (resultCode != Activity.RESULT_OK) return // 取消 / 没说话：不打扰
    val spoken = data
      ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
      ?.firstOrNull()
      ?.trim()
      .orEmpty()
    if (spoken.isEmpty()) return
    val current = edit.text.toString().trim()
    edit.setText(if (current.isEmpty()) spoken else "$current $spoken")
    edit.setSelection(edit.text.length)
  }

  companion object {
    /** 必须与 app.json 里的 `scheme` 一致 */
    private const val CAPTURE_URL = "aischedule://capture"

    /** 分享用的标记：带上它，弹窗才知道这次是"别人分享过来的" */
    const val EXTRA_FROM_SHARE = "com.aiyuexi.aischedule.EXTRA_FROM_SHARE"

    private const val REQUEST_SPEECH = 1301

    /** 配色对齐 widgets.tsx 的 PALETTE */
    private const val CARD_LIGHT = 0xFFFAF9F7.toInt()
    private const val CARD_DARK = 0xFF1F1E1C.toInt()
    private const val TEXT_LIGHT = 0xFF1B1A18.toInt()
    private const val TEXT_DARK = 0xFFF2F0EB.toInt()
    private const val SECONDARY_LIGHT = 0xFF6D6A63.toInt()
    private const val SECONDARY_DARK = 0xFFB5B1A8.toInt()
    private const val FIELD_LIGHT = 0xFFF0EEE9.toInt()
    private const val FIELD_DARK = 0xFF2A2926.toInt()
  }
}

/** GradientDrawable 的小外壳，只为少写两遍 apply 块 */
private object GradientDrawableCompat {
  fun rounded(color: Int, radiusPx: Int) = android.graphics.drawable.GradientDrawable().apply {
    setColor(color)
    cornerRadius = radiusPx.toFloat()
  }
}
