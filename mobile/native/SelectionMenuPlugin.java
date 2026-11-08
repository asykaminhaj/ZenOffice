package com.example.genoffice;

import android.app.SearchManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.widget.PopupMenu;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;

import androidx.core.content.FileProvider;
import java.io.InputStream;

/**
 * Menangkap toolbar seleksi teks native (Cut/Copy/Paste/Select all/Web search/
 * Share/Autofill/Translate...) dan mengirim daftar itemnya ke JS, tanpa
 * menampilkan toolbar native. Klik item di menu ZenOffice memanggil item native
 * yang sama (invoke), jadi Paste memakai jalur native yang terbukti jalan.
 *
 * Default NONAKTIF: toolbar native tetap normal sampai JS memanggil
 * setEnabled({ enabled: true }).
 */
@CapacitorPlugin(name = "SelectionMenu")
public class SelectionMenuPlugin extends Plugin {
    static SelectionMenuPlugin instance;

    private boolean enabled = false;
    private ZenMode mode;
    private JSArray lastItems = new JSArray();

    @Override
    public void load() {
        instance = this;
    }

    boolean isEnabled() {
        return enabled;
    }

    /** Dipanggil MainActivity.onWindowStartingActionMode (thread UI). */
    ActionMode startMode(ActionMode.Callback cb) {
        ZenMode m = new ZenMode(getContext(), getBridge().getWebView(), cb);
        if (!cb.onCreateActionMode(m, m.getMenu())) return null;
        mode = m;
        m.invalidate();
        return m;
    }

    private void publish(ZenMode m) {
        JSArray arr = new JSArray();
        Menu menu = m.getMenu();
        for (int i = 0; i < menu.size(); i++) {
            MenuItem it = menu.getItem(i);
            if (!it.isVisible()) continue;
            JSObject o = new JSObject();
            o.put("index", i);
            o.put("id", it.getItemId());
            o.put("title", String.valueOf(it.getTitle()));
            String entry = "";
            try { entry = getContext().getResources().getResourceEntryName(it.getItemId()); } catch (Exception ignored) { }
            o.put("entry", entry);
            o.put("enabled", it.isEnabled());
            arr.put(o);
        }
        lastItems = arr;
        JSObject res = new JSObject();
        res.put("items", arr);
        notifyListeners("items", res);
    }

    private void finishMode() {
        ZenMode m = mode;
        if (m != null) m.finish();
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (!enabled) getActivity().runOnUiThread(this::finishMode);
        call.resolve();
    }

    @PluginMethod
    public void getItems(PluginCall call) {
        JSObject res = new JSObject();
        res.put("active", mode != null);
        res.put("items", lastItems);
        call.resolve(res);
    }

    @PluginMethod
    public void invoke(PluginCall call) {
        final Integer idx = call.getInt("index");
        getActivity().runOnUiThread(() -> {
            ZenMode m = mode;
            if (m == null || idx == null || idx < 0 || idx >= m.getMenu().size()) {
                call.reject("no active selection menu");
                return;
            }
            MenuItem it = m.getMenu().getItem(idx);
            boolean handled = it.isEnabled() && m.cb.onActionItemClicked(m, it);
            JSObject res = new JSObject();
            res.put("handled", handled);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void dismiss(PluginCall call) {
        getActivity().runOnUiThread(this::finishMode);
        call.resolve();
    }

    @PluginMethod
    public void readClipboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject res = new JSObject();
            String text = "";
            String html = "";
            try {
                ClipboardManager cm =
                        (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData cd = cm == null ? null : cm.getPrimaryClip();
                if (cd != null && cd.getItemCount() > 0) {
                    ClipData.Item it = cd.getItemAt(0);
                    Uri uri = it.getUri();
                    String type = uri == null ? null : getContext().getContentResolver().getType(uri);
                    if (type != null && type.startsWith("image/")) {
                        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                            ByteArrayOutputStream out = new ByteArrayOutputStream();
                            byte[] buf = new byte[16384];
                            int n;
                            int total = 0;
                            while (in != null && total < 12000000 && (n = in.read(buf)) > 0) {
                                out.write(buf, 0, n);
                                total += n;
                            }
                            res.put("imageBase64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                            res.put("imageType", type);
                        }
                    } else {
                        CharSequence t = it.coerceToText(getContext());
                        text = t == null ? "" : t.toString();
                        String h = it.getHtmlText();
                        html = h == null ? "" : h;
                    }
                }
            } catch (Exception e) {
                res.put("error", String.valueOf(e.getMessage()));
            }
            res.put("text", text);
            res.put("html", html);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void webSearch(PluginCall call) {
        final String q = call.getString("text", "");
        getActivity().runOnUiThread(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_WEB_SEARCH);
                i.putExtra(SearchManager.QUERY, q);
                getActivity().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                try {
                    getActivity().startActivity(new Intent(Intent.ACTION_VIEW,
                            Uri.parse("https://www.google.com/search?q=" + Uri.encode(q))));
                    call.resolve();
                } catch (Exception e2) {
                    call.reject(String.valueOf(e2.getMessage()));
                }
            }
        });
    }

    /** Kirim file (base64) sebagai lampiran: tulis ke cache/share, bagikan lewat FileProvider. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        final String b64 = call.getString("data", "");
        final String rawName = call.getString("name", "Document.docx");
        final String mime = call.getString("mime", "application/octet-stream");
        if (b64 == null || b64.isEmpty()) {
            call.reject("no data");
            return;
        }
        try {
            String name = rawName.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            if (name.isEmpty()) name = "Document";
            if (!name.contains(".")) name += ".docx";
            File dir = new File(getContext().getCacheDir(), "share");
            dir.mkdirs();
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            File out = new File(dir, name);
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".zenfileprovider", out);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri(name, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            final Intent chooser = Intent.createChooser(send, null);
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(chooser);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(String.valueOf(e.getMessage()));
                }
            });
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        final String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> {
            try {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                getActivity().startActivity(Intent.createChooser(send, null));
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    /** ActionMode tanpa UI: hanya menampung Menu dan callback bawaan WebView. */
    private class ZenMode extends ActionMode {
        final ActionMode.Callback cb;
        private final Context ctx;
        private final Menu menu;
        private CharSequence title, subtitle;
        private View custom;
        private boolean finished;

        ZenMode(Context ctx, View anchor, ActionMode.Callback cb) {
            this.ctx = ctx;
            this.cb = cb;
            this.menu = new PopupMenu(ctx, anchor).getMenu();
        }

        @Override public void invalidate() {
            if (finished) return;
            cb.onPrepareActionMode(this, menu);
            publish(this);
        }

        @Override public void finish() {
            if (finished) return;
            finished = true;
            cb.onDestroyActionMode(this);
            if (mode == this) mode = null;
            lastItems = new JSArray();
            notifyListeners("closed", new JSObject());
        }

        @Override public int getType() { return TYPE_FLOATING; }
        @Override public Menu getMenu() { return menu; }
        @Override public MenuInflater getMenuInflater() { return new MenuInflater(ctx); }
        @Override public void invalidateContentRect() { }
        @Override public void hide(long duration) { }
        @Override public void setTitle(CharSequence t) { title = t; }
        @Override public void setTitle(int resId) { title = ctx.getString(resId); }
        @Override public void setSubtitle(CharSequence t) { subtitle = t; }
        @Override public void setSubtitle(int resId) { subtitle = ctx.getString(resId); }
        @Override public CharSequence getTitle() { return title; }
        @Override public CharSequence getSubtitle() { return subtitle; }
        @Override public void setCustomView(View v) { custom = v; }
        @Override public View getCustomView() { return custom; }
    }
}
