package com.burrow.touchruntime

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TouchRuntimeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TouchRuntime")
    AsyncFunction("capabilities") {
      val context = requireNotNull(appContext.reactContext)
      val info = ActivityManager.MemoryInfo()
      (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
      val runtime = Runtime.getRuntime()
      val heapHeadroom = (runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory())).coerceAtLeast(0)
      val vibrator = if (Build.VERSION.SDK_INT >= 31)
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
      else @Suppress("DEPRECATION") (context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
      val enabled = Settings.System.getInt(context.contentResolver, Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0
      mapOf("availableBytes" to minOf(heapHeadroom, info.availMem), "lowMemory" to info.lowMemory,
        "hasVibrator" to vibrator.hasVibrator(), "systemHaptics" to if (enabled) "enabled" else "disabled")
    }
  }
}
