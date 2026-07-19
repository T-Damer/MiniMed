package dev.localmed.search;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalMedDatabasePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
