package dev.localmed.search;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String WEB_ASSET_CACHE_PREFS = "LocalMedWebAssetCache";
    private static final String WEB_ASSET_CACHE_VERSION = "version";

    /** The fastest mode with the current physical resolution, so the resolution never changes. */
    static Display.Mode fastestModeAtCurrentResolution(Display display) {
        Display.Mode current = display.getMode();
        Display.Mode fastest = current;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() == current.getPhysicalWidth()
                    && mode.getPhysicalHeight() == current.getPhysicalHeight()
                    && mode.getRefreshRate() > fastest.getRefreshRate()) {
                fastest = mode;
            }
        }
        return fastest;
    }

    @Override
    public void onResume() {
        super.onResume();
        Display.Mode fastest = fastestModeAtCurrentResolution(getWindowManager().getDefaultDisplay());
        // Preferences only: Android keeps battery, thermal and user-policy limits. Some vendor
        // policies (observed on HyperOS) ignore preferredRefreshRate but honour an explicit mode.
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        attributes.preferredRefreshRate = fastest.getRefreshRate();
        attributes.preferredDisplayModeId = fastest.getModeId();
        getWindow().setAttributes(attributes);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            // Android 15 adaptive refresh: ask for the high category instead of letting an idle
            // WebView be classified as a low-rate surface, and opt out of power-saving lowering.
            getWindow().setFrameRatePowerSavingsBalanced(false);
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView != null) {
                webView.setRequestedFrameRate(View.REQUESTED_FRAME_RATE_CATEGORY_HIGH);
            }
        }
    }

    private boolean shouldClearWebAssetCache() {
        String version;
        try {
            PackageInfo packageInfo =
                    getPackageManager().getPackageInfo(getPackageName(), 0);
            version =
                    String.valueOf(packageInfo.versionName)
                            + ":"
                            + PackageInfoCompat.getLongVersionCode(packageInfo);
        } catch (PackageManager.NameNotFoundException exception) {
            return false;
        }
        SharedPreferences preferences =
                getSharedPreferences(WEB_ASSET_CACHE_PREFS, MODE_PRIVATE);
        if (version.equals(preferences.getString(WEB_ASSET_CACHE_VERSION, null))) {
            return false;
        }
        preferences.edit().putString(WEB_ASSET_CACHE_VERSION, version).apply();
        return true;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().setNavigationBarDividerColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        registerPlugin(LocalMedDatabasePlugin.class);
        registerPlugin(LlamaInferencePlugin.class);
        registerPlugin(LocalMedUpdatePlugin.class);
        registerPlugin(LocalMedHapticsPlugin.class);
        registerPlugin(LocalMedSharePlugin.class);
        registerPlugin(LocalMedSystemUiPlugin.class);
        registerPlugin(LocalMedPatientVaultPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null && shouldClearWebAssetCache()) {
            webView.clearCache(true);
            webView.reload();
        }

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        boolean darkMode =
                (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                        == Configuration.UI_MODE_NIGHT_YES;
        controller.setAppearanceLightStatusBars(!darkMode);
        controller.setAppearanceLightNavigationBars(!darkMode);
    }
}
