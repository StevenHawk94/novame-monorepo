package com.burrow.widgetsync

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
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
      if (!output.has("avatarFile")) input.optJSONObject("avatar")?.let { avatar ->
        val bitmap=Bitmap.createBitmap(128,128,Bitmap.Config.ARGB_8888)
        val canvas=Canvas(bitmap)
        val paint=Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color=runCatching { Color.parseColor(avatar.optString("backgroundColor", "#A35C43")) }.getOrDefault(Color.rgb(163,92,67))
        canvas.drawCircle(64f,64f,64f,paint)
        paint.color=Color.rgb(255,249,240);paint.textSize=56f;paint.typeface=Typeface.create(Typeface.DEFAULT,Typeface.BOLD);paint.textAlign=Paint.Align.CENTER
        canvas.drawText(avatar.optString("initial", "?"),64f,64f-(paint.ascent()+paint.descent())/2,paint)
        val file=File(directory,"avatar")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
        bitmap.recycle();output.put("avatarFile",file.absolutePath)
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
