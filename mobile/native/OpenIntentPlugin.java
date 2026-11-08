package com.example.genoffice;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Open with": files other apps hand to ZenOffice (ACTION_VIEW). The content://
 * stream is only readable for a short time, so it is copied into the app cache
 * and JS picks the copies up with takePending().
 */
@CapacitorPlugin(name = "OpenIntent")
public class OpenIntentPlugin extends Plugin {
    private static final ExecutorService COPY = Executors.newSingleThreadExecutor();
    private static final List<JSObject> PENDING = new ArrayList<>();
    private static volatile OpenIntentPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void storageAccessStatus(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            granted = Environment.isExternalStorageManager();
        }
        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }

    @PluginMethod
    public void requestStorageAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            call.resolve();
            return;
        }
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent i2 = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                i2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i2);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Cannot open all-files-access settings");
            }
        }
    }

    public static void enqueue(final Context ctx, final Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        final Uri uri = intent.getData();
        if (uri == null) return;
        final String type = intent.getType();
        // consumed: a recreated activity must not open the same file again
        intent.setAction(Intent.ACTION_MAIN);
        final Context app = ctx.getApplicationContext();
        COPY.execute(() -> {
            try {
                String mime = type != null ? type : app.getContentResolver().getType(uri);
                String name = ensureExtension(displayName(app, uri), mime);
                File dir = new File(app.getCacheDir(), "open-intent");
                dir.mkdirs();
                File out = new File(dir, System.nanoTime() + "-" + name);
                try (InputStream in = app.getContentResolver().openInputStream(uri);
                     OutputStream os = new FileOutputStream(out)) {
                    if (in == null) throw new Exception("no stream");
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                JSObject o = new JSObject();
                o.put("name", name);
                o.put("type", mime == null ? "" : mime);
                o.put("path", "open-intent/" + out.getName());
                o.put("size", out.length());
                synchronized (PENDING) {
                    PENDING.add(o);
                }
                final OpenIntentPlugin p = instance;
                if (p != null) {
                    new Handler(Looper.getMainLooper()).post(() -> p.notifyListeners("pending", new JSObject()));
                }
            } catch (Exception e) {
                /* unreadable stream: nothing to open */
            }
        });
    }

    private static String displayName(Context ctx, Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = ctx.getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) {
            }
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "Untitled";
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return name.isEmpty() ? "Untitled" : name;
    }

    private static String ensureExtension(String name, String mime) {
        if (name.lastIndexOf('.') > 0 || mime == null) return name;
        String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
        if (ext == null && mime.contains("markdown")) ext = "md";
        return ext == null ? name : name + "." + ext;
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (PENDING) {
            for (JSObject o : PENDING) arr.put(o);
            PENDING.clear();
        }
        JSObject ret = new JSObject();
        ret.put("files", arr);
        call.resolve(ret);
    }
}
