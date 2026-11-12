package com.brianjonahdennis.treehouse;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saves and shares the story images (anonymous messages as JPEG cards) from the web app.
 * The app's web view can't save images on long-press or download blob: links, so the page calls
 * this instead when it runs inside the app:
 *   Capacitor.Plugins.TreehouseImage.save({ data: <base64 jpeg>, filename })  -> Pictures/treehouse
 *   Capacitor.Plugins.TreehouseImage.share({ data, filename, text })           -> Android share menu
 */
@CapacitorPlugin(
    name = "TreehouseImage",
    permissions = { @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class TreehouseImagePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        // Android 10+ saves to the shared Pictures folder without any permission.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermission");
            return;
        }
        doSave(call);
    }

    @PermissionCallback
    private void storagePermission(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) doSave(call);
        else call.reject("Allow storage access to save images.", "PERMISSION_DENIED");
    }

    private void doSave(PluginCall call) {
        byte[] bytes = decode(call);
        if (bytes == null) return;
        String filename = safeName(call.getString("filename", "treehouse.jpg"));
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        Uri uri = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/treehouse");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new Exception("Couldn't create the image.");
                try (OutputStream out = resolver.openOutputStream(uri)) { out.write(bytes); }
                ContentValues done = new ContentValues();
                done.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, done, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "treehouse");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Couldn't create the Pictures/treehouse folder.");
                File file = new File(dir, filename);
                try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
                values.put(MediaStore.Images.Media.DATA, file.getAbsolutePath());
                resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);   // shows it in the gallery
            }
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception e) {
            if (uri != null) resolver.delete(uri, null, null);
            call.reject("Couldn't save the image.", e);
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        byte[] bytes = decode(call);
        if (bytes == null) return;
        try {
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists()) dir.mkdirs();
            File file = new File(dir, safeName(call.getString("filename", "treehouse.jpg")));
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/jpeg");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            String text = call.getString("text");
            if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Share");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve(new JSObject().put("shared", true));
        } catch (Exception e) {
            call.reject("Couldn't share the image.", e);
        }
    }

    private byte[] decode(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) { call.reject("No image."); return null; }
        int comma = data.indexOf(',');
        if (data.startsWith("data:") && comma > 0) data = data.substring(comma + 1);   // accept data: URLs too
        try { return Base64.decode(data, Base64.DEFAULT); }
        catch (IllegalArgumentException e) { call.reject("That image couldn't be read."); return null; }
    }

    private static String safeName(String name) {
        String clean = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!clean.toLowerCase().endsWith(".jpg") && !clean.toLowerCase().endsWith(".jpeg")) clean += ".jpg";
        return clean.length() > 80 ? clean.substring(clean.length() - 80) : clean;
    }
}
