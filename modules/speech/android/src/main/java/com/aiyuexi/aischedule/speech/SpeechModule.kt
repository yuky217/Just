package com.aiyuexi.aischedule.speech

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 语音输入（2026-10-13）—— 系统语音识别的薄封装。
 *
 * 为什么不自己持有麦克风：走 `RecognizerIntent` 弹系统/输入法自带的识别界面，
 * ① 不需要 RECORD_AUDIO 授权（识别在别的进程里发生）；
 * ② 不依赖 Google 服务 —— 只要设备上有一个认 ACTION_RECOGNIZE_SPEECH 的组件
 *    （华为/鸿蒙通常有）就能用，这正是 2026-10-11 方案里"待真机调研"的那件事，
 *    现在用系统 Intent 这条路落地，调研结论写进 README。
 *
 * 为什么不是事件推送而是 Promise：一次只说一句话，说完这次调用就结束 ——
 * Promise 天然适配"一次动作一个结果"。连续听写（事件流）不做：
 * 新建事项是"说一句记一句"，不是"边听边打字"。
 *
 * 一次只认一句话：[pending] 非空时再来请求直接拒绝，不会开两个识别界面。
 */
class SpeechModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** 识别界面开着的这段时间里，等着被 resolve/reject 的那个 Promise */
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    // JS 侧用 requireOptionalNativeModule('Speech') 找这个名字
    Name("Speech")

    /** 这台设备有没有可用的语音识别组件。网页/Expo Go/iOS 一律 false（模块不存在） */
    Function("isAvailable") {
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      context.packageManager.queryIntentActivities(intent, 0).isNotEmpty()
    }

    /*
     * 弹识别界面，把说的话变成文字。promise 是尾参数（expo 的
     * AsyncFunctionWithPromise 约定）—— 这里**不**当场 resolve：
     * 结果要从 [OnActivityResult] 回来，那可能是几十秒以后。
     */
    AsyncFunction("recognize") { prompt: String?, promise: Promise ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      if (pending != null) {
        throw CodedException("E_SPEECH_BUSY", "上一次语音识别还没结束", null)
      }
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
        putExtra(RecognizerIntent.EXTRA_PROMPT, prompt ?: "说话就行")
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      }
      pending = promise
      try {
        activity.startActivityForResult(intent, REQUEST_SPEECH)
      } catch (_: ActivityNotFoundException) {
        // 有组件名单却启动失败（被禁用/刚卸载）：如实报"没有"
        pending = null
        throw CodedException("E_SPEECH_UNAVAILABLE", "这台设备没有可用的语音识别", null)
      } catch (_: Exception) {
        pending = null
        throw CodedException("E_SPEECH_LAUNCH_FAILED", "语音识别打不开", null)
      }
    }.runOnQueue(Queues.MAIN)

    /*
     * 识别结果回来。取消/没说话都算"用户没给"—— reject 一个专用 code，
     * JS 侧见到它就当没发生过，不弹错误。
     */
    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_SPEECH) return@OnActivityResult
      val target = pending ?: return@OnActivityResult
      pending = null
      if (payload.resultCode == Activity.RESULT_OK) {
        val spoken = payload.data
          ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
          ?.firstOrNull()
          ?.trim()
          .orEmpty()
        target.resolve(spoken)
      } else {
        target.reject(CodedException("E_SPEECH_CANCELLED", "语音识别取消了", null))
      }
    }
  }

  private companion object {
    const val REQUEST_SPEECH = 1301
  }
}
