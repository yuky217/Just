package com.aiyuexi.aischedule.overlay

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import java.io.File
import java.net.URLEncoder

/**
 * 系统分享入口：**在别的 App 里看到的东西，一键记进 JUST**（2026-10-13）。
 *
 * 它自己**没有界面**：收到分享 → 分一路转出去 → 立刻收工。
 * 这个 Activity 存在的全部意义就是"分享菜单里多出一个 JUST"，
 * 真界面在别处：
 * - **文字** → 交给 `CaptureDialogActivity`（同一个透明弹窗，预填好文字让人确认）；
 * - **图片** → 存进本应用缓存，深链打开记录页，由 JS 侧去 OCR。
 *
 * 为什么图片不也弹那个窗：图片要先"识别成文字"才有东西可填，
 * 而识别在 JS 侧（OCR 的接口配置、联网都在那边，原生不该知道）。
 * 弹窗里画不出"正在识别"，硬画就是一次假loading —— 不如直接开记录页，
 * 在那里明明白白显示识别结果，用户可以改完再记。
 *
 * ⚠️ 为什么它与 `CaptureDialogActivity` 是两个 Activity：
 * 后者 `exported=false`（只接受本应用通知栏那条 PendingIntent），
 * 那是刻意的边界 —— 分享入口必须 `exported=true`（要被别的 App 唤起），
 * 两个合一个就得把那条边界拆掉。宁可多一个三十行的转发器。
 */
class ShareEntryActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    dispatch(intent)
    // 无 UI，转完就走。留着只会让分享菜单点完之后多一个空白任务
    finish()
  }

  private fun dispatch(source: Intent?) {
    if (source?.action != Intent.ACTION_SEND) return

    val text = source.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
    if (text.isNotEmpty()) {
      forwardText(text)
      return
    }

    val image = readStreamUri(source)
    if (image != null) {
      val saved = copyToCache(image)
      if (saved != null) {
        forwardImage(saved)
        return
      }
    }
    Toast.makeText(this, "这段内容 JUST 记不了（只认文字和图片）", Toast.LENGTH_SHORT).show()
  }

  /** 文字：交给透明弹窗，让人看一眼再记 */
  private fun forwardText(text: String) {
    startActivity(
      Intent(this, CaptureDialogActivity::class.java)
        .putExtra(Intent.EXTRA_TEXT, text)
        .putExtra(CaptureDialogActivity.EXTRA_FROM_SHARE, true)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  /**
   * 图片：存进缓存再深链给记录页。
   *
   * 传**缓存里的文件路径**而不是分享来的那个 `content://` Uri：
   * 跨进程 Uri 的读权限是一次性的（跟着那次 grant 走），
   * 等 JS 侧要读它去做 OCR 时，权限早没了 —— 复制一份才稳。
   */
  private fun forwardImage(file: File) {
    val path = try {
      URLEncoder.encode(file.absolutePath, "UTF-8")
    } catch (_: Exception) {
      return
    }
    // src=screenshot：库里的 CaptureSource.Screenshot。截图分享进来是这条路的
    // 主要场景（"截一张课表/通知丢进去"），名字就这么定的
    val url = "$CAPTURE_URL?image=$path&src=screenshot"
    try {
      startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse(url))
          .setPackage(packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    } catch (_: Exception) {
      Toast.makeText(this, "打不开 JUST", Toast.LENGTH_SHORT).show()
    }
  }

  @Suppress("DEPRECATION")
  private fun readStreamUri(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }

  private fun copyToCache(uri: Uri): File? {
    val dir = File(cacheDir, SHARE_DIR).apply { mkdirs() }
    val ext = when (contentResolver.getType(uri)) {
      "image/png" -> "png"
      "image/webp" -> "webp"
      "image/gif" -> "gif"
      else -> "jpg"
    }
    val file = File(dir, "share-${System.currentTimeMillis()}.$ext")
    return try {
      contentResolver.openInputStream(uri)?.use { input ->
        file.outputStream().use { output -> input.copyTo(output) }
      }
      // 复制出来是空的 = 这次分享拿不到内容，别给 JS 一个不存在的文件路径
      if (file.length() > 0) file else null
    } catch (_: Exception) {
      null
    }
  }

  companion object {
    /** 必须与 app.json 里的 `scheme` 一致 */
    private const val CAPTURE_URL = "aischedule://capture"

    /** 分享进来的图片先落在这儿（cacheDir 下，系统清理时一起走，不占用户空间） */
    private const val SHARE_DIR = "shares"
  }
}
