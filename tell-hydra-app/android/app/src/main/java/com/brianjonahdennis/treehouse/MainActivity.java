package com.brianjonahdennis.treehouse;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TreehouseImagePlugin.class);   // save / share story images (see the plugin)
        registerPlugin(InstallSourcePlugin.class);    // Google Play or APK install (for Play test stats)
        registerPlugin(SecureScreenPlugin.class);     // Speed Dating: no screenshots or screen recording during dates
        super.onCreate(savedInstanceState);
    }
}
