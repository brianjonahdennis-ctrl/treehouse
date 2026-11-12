package com.brianjonahdennis.treehouse;

import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Speed Dating privacy: while a video date is on screen, the web app turns this on so screenshots
 * and screen recordings of treehouse come out black (and the app is hidden in the recent-apps
 * preview). It's turned off again when the person leaves Speed Dating, so ordinary screenshots work.
 * Uses Android's FLAG_SECURE.
 */
@CapacitorPlugin(name = "SecureScreen")
public class SecureScreenPlugin extends Plugin {
    @PluginMethod
    public void set(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }
}
