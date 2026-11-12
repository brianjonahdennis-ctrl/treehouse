package com.brianjonahdennis.treehouse;

import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web app where this copy of treehouse was installed from:
 * "com.android.vending" = Google Play (so Play test usage can be counted), anything else or null =
 * installed from the APK on treehouse.ng. Nothing personal: just the installer's package name and
 * the app version.
 */
@CapacitorPlugin(name = "InstallSource")
public class InstallSourcePlugin extends Plugin {
    @PluginMethod
    public void get(PluginCall call) {
        String installer = null;
        String version = null;
        try {
            version = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (Exception ignored) { }
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                installer = pm.getInstallSourceInfo(pkg).getInstallingPackageName();
            } else {
                installer = pm.getInstallerPackageName(pkg);
            }
        } catch (Exception ignored) {
            // Unknown: treated as "not from Play".
        }
        JSObject result = new JSObject();
        result.put("installer", installer);
        result.put("play", "com.android.vending".equals(installer));
        result.put("version", version);
        call.resolve(result);
    }
}
