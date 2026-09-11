package dev.localmed.search;

import static org.junit.Assert.assertEquals;

import android.view.Display;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class RefreshRateTest {
    @Test
    public void requestsHighestRefreshRateWithoutChoosingResolution() {
        try (ActivityScenario<MainActivity> app = ActivityScenario.launch(MainActivity.class)) {
            app.onActivity(activity -> {
                Display display = activity.getWindowManager().getDefaultDisplay();
                Display.Mode current = display.getMode();
                float expected = current.getRefreshRate();
                for (Display.Mode mode : display.getSupportedModes()) {
                    if (mode.getPhysicalWidth() == current.getPhysicalWidth()
                            && mode.getPhysicalHeight() == current.getPhysicalHeight()) {
                        expected = Math.max(expected, mode.getRefreshRate());
                    }
                }
                assertEquals(expected,
                        activity.getWindow().getAttributes().preferredRefreshRate, 0.01f);
                assertEquals(0, activity.getWindow().getAttributes().preferredDisplayModeId);
            });
        }
    }
}
