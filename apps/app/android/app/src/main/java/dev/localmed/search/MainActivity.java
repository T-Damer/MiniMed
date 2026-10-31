package dev.localmed.search;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Display;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private static final String WEB_ASSET_CACHE_PREFS = "LocalMedWebAssetCache";
    private static final String WEB_ASSET_CACHE_VERSION = "version";
    /** The splash never outstays this, even if the page never reports its first screen. */
    private static final long SPLASH_MAX_MS = 4000;
    /** The splash fades onto the identical web boot surface; see apps/app/index.html. */
    private static final long SPLASH_EXIT_MS = 180;

    private volatile boolean webBootReady = false;

    /** The page has painted its boot surface over a ready first screen (BootBridge.ready). */
    void markWebBootReady() {
        webBootReady = true;
    }

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

    /**
     * The page draws under the status and navigation bars on every WebView. Capacitor's SystemBars
     * only lets WebView 140+ do that and pads older ones between the bars (opaque strips above and
     * below the page); the page reads the insets from the --safe-area-inset-* variables either way,
     * so they are written here and the container only makes room for the keyboard.
     */
    private void drawUnderSystemBars(WebView webView, View host) {
        ViewCompat.setOnApplyWindowInsetsListener(
                host,
                (view, insets) -> {
                    Insets bars =
                            insets.getInsets(
                                    WindowInsetsCompat.Type.systemBars()
                                            | WindowInsetsCompat.Type.displayCutout());
                    boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
                    int keyboardBottom =
                            keyboard ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
                    view.setPadding(0, 0, 0, keyboardBottom);
                    float density = getResources().getDisplayMetrics().density;
                    String script =
                            String.format(
                                    Locale.US,
                                    "(() => { const s = document.documentElement.style;"
                                            + " s.setProperty('--safe-area-inset-top', '%dpx');"
                                            + " s.setProperty('--safe-area-inset-right', '%dpx');"
                                            + " s.setProperty('--safe-area-inset-bottom', '%dpx');"
                                            + " s.setProperty('--safe-area-inset-left', '%dpx'); })()",
                                    (int) (bars.top / density),
                                    (int) (bars.right / density),
                                    (int) ((keyboard ? 0 : bars.bottom) / density),
                                    (int) (bars.left / density));
                    webView.evaluateJavascript(script, null);
                    return insets;
                });
        ViewCompat.requestApplyInsets(host);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        long splashStart = SystemClock.uptimeMillis();
        splashScreen.setKeepOnScreenCondition(
                () -> !webBootReady && SystemClock.uptimeMillis() - splashStart < SPLASH_MAX_MS);
        splashScreen.setOnExitAnimationListener(
                provider ->
                        provider.getView()
                                .animate()
                                .alpha(0f)
                                .setDuration(SPLASH_EXIT_MS)
                                .setInterpolator(new PathInterpolator(0.32f, 0.72f, 0f, 1f))
                                .withEndAction(provider::remove)
                                .start());
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
        registerPlugin(LocalMedCameraPlugin.class);
        registerPlugin(LocalMedTranscriberPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) {
            // Until the page paints, the WebView shows the splash ground (light or night), not white.
            webView.setBackgroundColor(ContextCompat.getColor(this, R.color.splashBackground));
        }
        if (webView != null && webView.getParent() instanceof View) {
            drawUnderSystemBars(webView, (View) webView.getParent());
        }
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
