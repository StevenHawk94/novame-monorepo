package com.burrow.widgetsync

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL

class WidgetSyncModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("WidgetSync")

    AsyncFunction("syncLatestFriendReflect") { payloadJson: String ->
      val input = JSONObject(payloadJson)
      val directory = File(context.filesDir, "burrow-widget").apply {
        deleteRecursively()
        mkdirs()
      }

      fun copySource(source: String, filename: String): String? = runCatching {
        val destination = File(directory, filename)
        val uri = Uri.parse(source)
        when (uri.scheme) {
          "file" -> File(uri.path ?: return@runCatching null).inputStream()
          "content" -> context.contentResolver.openInputStream(uri)
          "http", "https" -> URL(source).openStream()
          else -> File(source).takeIf { it.exists() }?.inputStream()
        }?.use { from -> destination.outputStream().use { to -> from.copyTo(to) } }
          ?: return@runCatching null
        destination.absolutePath
      }.getOrNull()

      val output = JSONObject(input.toString())
      input.optJSONObject("avatar")?.optString("src")?.takeIf { it.isNotBlank() }?.let {
        copySource(it, "avatar")?.let { path -> output.put("avatarFile", path) }
      }
      val sourceItems = input.optJSONArray("items") ?: JSONArray()
      val outputItems = JSONArray()
      for (index in 0 until minOf(sourceItems.length(), 6)) {
        val sourceItem = sourceItems.optJSONObject(index) ?: JSONObject()
        val item = JSONObject().put("emoji", sourceItem.optString("emoji", "✨"))
        sourceItem.optString("src").takeIf { it.isNotBlank() }?.let {
          copySource(it, "item-$index")?.let { path -> item.put("file", path) }
        }
        outputItems.put(item)
      }
      output.put("items", outputItems)
      context.getSharedPreferences(BurrowWidgetProvider.PREFS, Context.MODE_PRIVATE)
        .edit().putString(BurrowWidgetProvider.PAYLOAD_KEY, output.toString()).apply()

      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, BurrowWidgetProvider::class.java)
      manager.getAppWidgetIds(component).forEach { widgetId ->
        BurrowWidgetProvider.updateWidget(context, manager, widgetId)
      }
      true
    }
  }
}
