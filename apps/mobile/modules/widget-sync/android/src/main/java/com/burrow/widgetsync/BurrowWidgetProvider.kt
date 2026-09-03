package com.burrow.widgetsync

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class BurrowWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    ids.forEach { updateWidget(context, manager, it) }
  }

  companion object {
    const val PREFS = "burrow_widget"
    const val PAYLOAD_KEY = "latest_friend_reflect"
    private val itemViews = intArrayOf(
      R.id.widget_item_1, R.id.widget_item_2, R.id.widget_item_3,
      R.id.widget_item_4, R.id.widget_item_5, R.id.widget_item_6,
    )

    /** RemoteViews serializes bitmaps through Binder. Decode every supplied
     * sprite to widget size so six source icons can never exceed Binder's
     * transaction limit (a common reason third-party launchers omit widgets). */
    private fun decodeWidgetBitmap(path: String, targetPx: Int): Bitmap? = runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@runCatching null
      var sample = 1
      while (bounds.outWidth / (sample * 2) >= targetPx && bounds.outHeight / (sample * 2) >= targetPx) {
        sample *= 2
      }
      val decoded = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: return@runCatching null
      val ratio = minOf(targetPx.toFloat() / decoded.width, targetPx.toFloat() / decoded.height, 1f)
      if (ratio >= 1f) decoded else Bitmap.createScaledBitmap(
        decoded,
        (decoded.width * ratio).toInt().coerceAtLeast(1),
        (decoded.height * ratio).toInt().coerceAtLeast(1),
        true,
      ).also { if (it !== decoded) decoded.recycle() }
    }.getOrNull()

    private fun gridBackground(): Bitmap {
      // Fixed low-resolution texture keeps the complete RemoteViews payload
      // comfortably below Binder limits while fitXY adapts to launcher sizes.
      val width = 320
      val height = 150
      val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      val rounded = Path().apply {
        addRoundRect(0f, 0f, width.toFloat(), height.toFloat(), 24f, 24f, Path.Direction.CW)
      }
      canvas.clipPath(rounded)
      canvas.drawColor(android.graphics.Color.rgb(248, 218, 177))
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.argb(105, 255, 247, 232)
        strokeWidth = 1.5f
      }
      var x = 22f
      while (x < width) { canvas.drawLine(x, 0f, x, height.toFloat(), paint); x += 28f }
      var y = 22f
      while (y < height) { canvas.drawLine(0f, y, width.toFloat(), y, paint); y += 28f }
      return bitmap
    }

    private fun relativeTime(value: String): String = runCatching {
      // Supabase may emit either millisecond or microsecond fractions and
      // either Z or a colon offset. Normalize long fractions, then accept both
      // legal ISO-8601 shapes on every supported Android API level.
      val normalized = value.replace(Regex("(\\.\\d{3})\\d+"), "\$1")
      var createdAt: java.util.Date? = null
      for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX")) {
        if (createdAt != null) break
        createdAt = runCatching {
          SimpleDateFormat(pattern, Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
          }.parse(normalized)
        }.getOrNull()
      }
      val parsed = createdAt ?: return@runCatching ""
      val minutes = ((System.currentTimeMillis() - parsed.time) / 60_000L).coerceAtLeast(0)
      when {
        minutes < 1 -> "now"
        minutes < 60 -> "${minutes}m ago"
        minutes < 1440 -> "${minutes / 60}h ago"
        else -> "${minutes / 1440}d ago"
      }
    }.getOrDefault("")

    fun updateWidget(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val views = RemoteViews(context.packageName, R.layout.burrow_widget)
      views.setImageViewBitmap(R.id.widget_grid_background, gridBackground())
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PAYLOAD_KEY, null)
      val payload = runCatching { raw?.let(::JSONObject) }.getOrNull()
      val state = payload?.optString("state") ?: "unpaired"
      val name = payload?.optString("name").orEmpty()
      val title = when (state) {
        "unpaired" -> "A PLACE FOR TWO"
        else -> "${name.ifBlank { "YOUR PERSON" }.uppercase()}’S DAY"
      }
      views.setTextViewText(R.id.widget_name, title)
      views.setTextViewText(R.id.widget_time, relativeTime(payload?.optString("createdAt").orEmpty()))

      payload?.optString("avatarFile")?.takeIf { it.isNotBlank() }?.let { path ->
        decodeWidgetBitmap(path, 96)?.let { views.setImageViewBitmap(R.id.widget_avatar, it) }
      }
      val items = payload?.optJSONArray("items")
      val hasItems = state == "latest" && items != null && items.length() > 0
      views.setViewVisibility(R.id.widget_items, if (hasItems) View.VISIBLE else View.GONE)
      views.setViewVisibility(R.id.widget_empty, if (hasItems) View.GONE else View.VISIBLE)
      views.setTextViewText(
        R.id.widget_empty,
        if (state == "unpaired") "Your Burrow is waiting for someone you want to keep close."
        else "No shared moments from ${name.ifBlank { "your person" }} yet.",
      )
      itemViews.forEach { views.setImageViewBitmap(it, null) }
      views.setViewVisibility(R.id.widget_more, View.GONE)
      if (hasItems) {
        val total = payload?.optInt("totalItems", items?.length() ?: 0) ?: 0
        for (index in 0 until minOf(items?.length() ?: 0, 6)) {
          items?.optJSONObject(index)?.optString("file")?.takeIf { it.isNotBlank() }?.let { path ->
            decodeWidgetBitmap(path, 112)?.let { views.setImageViewBitmap(itemViews[index], it) }
          }
        }
        if (total > 6) {
          views.setImageViewBitmap(R.id.widget_item_6, null)
          views.setTextViewText(R.id.widget_more, "+${total - 5}")
          views.setViewVisibility(R.id.widget_more, View.VISIBLE)
        }
      }

      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("novame://friends")).apply {
        setPackage(context.packageName)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      val pendingIntent = PendingIntent.getActivity(
        context, widgetId, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)
      manager.updateAppWidget(widgetId, views)
    }
  }
}
