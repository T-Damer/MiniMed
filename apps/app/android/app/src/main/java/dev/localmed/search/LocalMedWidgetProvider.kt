package dev.localmed.search

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * Home-screen quick-access widget (Wave 4.1): launches MiniMed directly into search,
 * medications, calculators, or notes without requiring network access or extra Gradle SDKs.
 */
class LocalMedWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        const val EXTRA_ROUTE_HASH = "dev.localmed.search.ROUTE_HASH"
        private const val REQUEST_SEARCH = 4101
        private const val REQUEST_DRUGS = 4102
        private const val REQUEST_CALC = 4103
        private const val REQUEST_NOTES = 4104

        private fun launchIntent(context: Context, requestCode: Int, routeHash: String): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_ROUTE_HASH, routeHash)
            }
            return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_minimed_quick)
            views.setOnClickPendingIntent(
                R.id.widget_search_bar,
                launchIntent(context, REQUEST_SEARCH, "#/search"),
            )
            views.setOnClickPendingIntent(
                R.id.widget_btn_drugs,
                launchIntent(context, REQUEST_DRUGS, "#/modules/documents/medications"),
            )
            views.setOnClickPendingIntent(
                R.id.widget_btn_calculators,
                launchIntent(context, REQUEST_CALC, "#/calculators"),
            )
            views.setOnClickPendingIntent(
                R.id.widget_btn_notes,
                launchIntent(context, REQUEST_NOTES, "#/notes"),
            )
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
