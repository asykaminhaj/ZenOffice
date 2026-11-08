package com.example.genoffice;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.print.PdfPrintHelper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.util.Base64;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.util.concurrent.atomic.AtomicBoolean;

/** Offscreen WebView -> PDF (no system print dialog). Returns { base64, size }. */
@CapacitorPlugin(name = "PdfExport")
public class PdfExportPlugin extends Plugin {
    private static final long TIMEOUT_MS = 120000;

    private static PrintAttributes attributes(double widthIn, double heightIn) {
        int wm = (int) Math.round(widthIn * 1000);
        int hm = (int) Math.round(heightIn * 1000);
        PrintAttributes.MediaSize size = new PrintAttributes.MediaSize(
                "custom", "custom", Math.min(wm, hm), Math.max(wm, hm));
        if (wm > hm) size = size.asLandscape();
        return new PrintAttributes.Builder()
                .setMediaSize(size)
                .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build();
    }

    private void run(final PluginCall call, final PrintDocumentAdapter adapter,
                     final PrintAttributes attrs, final WebView toDestroy) {
        final File out = new File(getContext().getCacheDir(), "pdfexport-" + System.nanoTime() + ".pdf");
        final AtomicBoolean finished = new AtomicBoolean(false);
        final Handler main = new Handler(Looper.getMainLooper());
        final Runnable timeout = () -> {
            if (!finished.compareAndSet(false, true)) return;
            if (toDestroy != null) toDestroy.destroy();
            out.delete();
            call.reject("PDF export timed out");
        };
        main.postDelayed(timeout, TIMEOUT_MS);
        PdfPrintHelper.write(adapter, attrs, out, (ok, error) -> {
            if (!finished.compareAndSet(false, true)) return;
            main.removeCallbacks(timeout);
            if (toDestroy != null) main.post(toDestroy::destroy);
            if (!ok) {
                out.delete();
                call.reject(error != null ? error : "PDF export failed");
                return;
            }
            new Thread(() -> {
                try {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    try (FileInputStream in = new FileInputStream(out)) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                    }
                    byte[] bytes = bos.toByteArray();
                    JSObject result = new JSObject();
                    result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    result.put("size", bytes.length);
                    call.resolve(result);
                } catch (Exception e) {
                    call.reject(String.valueOf(e.getMessage()));
                } finally {
                    out.delete();
                }
            }).start();
        });
    }

    @PluginMethod
    public void printCurrent(final PluginCall call) {
        final double w = call.getDouble("widthIn", 8.27);
        final double h = call.getDouble("heightIn", 11.69);
        final int delay = call.getInt("delayMs", 550);
        getActivity().runOnUiThread(() -> {
            try {
                final WebView wv = getBridge().getWebView();
                final PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter("ZenOffice");
                final PrintAttributes attrs = attributes(w, h);
                new Handler(Looper.getMainLooper()).postDelayed(
                        () -> run(call, adapter, attrs, null), delay);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void printHtml(final PluginCall call) {
        final String html = call.getString("html", "");
        final String baseUrl = call.getString("baseUrl", "https://localhost/");
        final int printDelayMs = call.getInt("delayMs", 700);
        final double w = call.getDouble("widthIn", 8.27);
        final double h = call.getDouble("heightIn", 11.69);
        getActivity().runOnUiThread(() -> {
            try {
                final PrintAttributes attrs = attributes(w, h);
                final WebView wv = new WebView(getActivity());
                WebSettings settings = wv.getSettings();
                settings.setJavaScriptEnabled(false);
                settings.setAllowFileAccess(false);
                float density = getActivity().getResources().getDisplayMetrics().density;
                int wpx = Math.round((float) (w * 96 * density));
                int hpx = Math.round((float) (h * 96 * density));
                wv.measure(View.MeasureSpec.makeMeasureSpec(wpx, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(hpx, View.MeasureSpec.EXACTLY));
                wv.layout(0, 0, wpx, hpx);
                // Reuse the shell's asset server so relative fonts/assets resolve.
                final WebViewClient parent = Build.VERSION.SDK_INT >= 26
                        ? getBridge().getWebView().getWebViewClient() : null;
                final AtomicBoolean started = new AtomicBoolean(false);
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        if (parent != null) {
                            try {
                                return parent.shouldInterceptRequest(view, request);
                            } catch (Exception e) {
                                return null;
                            }
                        }
                        return null;
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (!started.compareAndSet(false, true)) return;
                        new Handler(Looper.getMainLooper()).postDelayed(
                                () -> run(call, wv.createPrintDocumentAdapter("ZenOffice"), attrs, wv), printDelayMs);
                    }
                });
                wv.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    private static PrintAttributes.MediaSize pickMedia(double w, double h) {
        final double a = Math.min(w, h);
        final double b = Math.max(w, h);
        final PrintAttributes.MediaSize[] sizes = {
            PrintAttributes.MediaSize.ISO_A3, PrintAttributes.MediaSize.ISO_A4,
            PrintAttributes.MediaSize.ISO_A5, PrintAttributes.MediaSize.ISO_B5,
            PrintAttributes.MediaSize.NA_LETTER, PrintAttributes.MediaSize.NA_LEGAL};
        final double[][] dims = {
            {11.69, 16.54}, {8.27, 11.69}, {5.83, 8.27}, {6.93, 9.84}, {8.5, 11.0}, {8.5, 14.0}};
        PrintAttributes.MediaSize base = null;
        for (int i = 0; i < sizes.length; i++) {
            if (Math.abs(dims[i][0] - a) < 0.06 && Math.abs(dims[i][1] - b) < 0.06) {
                base = sizes[i];
                break;
            }
        }
        if (base == null) {
            base = new PrintAttributes.MediaSize("custom", "custom",
                    (int) Math.round(a * 1000), (int) Math.round(b * 1000));
        }
        return w > h ? base.asLandscape() : base.asPortrait();
    }

    /** HTML -> offscreen WebView -> Android PrintManager (system print dialog: printers, copies, Save as PDF). */
    @PluginMethod
    public void printSystem(final PluginCall call) {
        final String html = call.getString("html", "");
        final String baseUrl = call.getString("baseUrl", "https://localhost/");
        final String jobName = call.getString("jobName", "ZenOffice");
        final int printDelayMs = call.getInt("delayMs", 700);
        final double w = call.getDouble("widthIn", 8.27);
        final double h = call.getDouble("heightIn", 11.69);
        final boolean mono = Boolean.TRUE.equals(call.getBoolean("monochrome", false));
        final String duplex = call.getString("duplex", "simplex");
        getActivity().runOnUiThread(() -> {
            try {
                PrintAttributes.Builder pb = new PrintAttributes.Builder()
                        .setMediaSize(pickMedia(w, h))
                        .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .setColorMode(mono ? PrintAttributes.COLOR_MODE_MONOCHROME
                                : PrintAttributes.COLOR_MODE_COLOR);
                if (Build.VERSION.SDK_INT >= 23) {
                    pb.setDuplexMode("longEdge".equals(duplex) ? PrintAttributes.DUPLEX_MODE_LONG_EDGE
                            : "shortEdge".equals(duplex) ? PrintAttributes.DUPLEX_MODE_SHORT_EDGE
                            : PrintAttributes.DUPLEX_MODE_NONE);
                }
                final PrintAttributes attrs = pb.build();
                final WebView wv = new WebView(getActivity());
                WebSettings settings = wv.getSettings();
                settings.setJavaScriptEnabled(false);
                settings.setAllowFileAccess(false);
                float density = getActivity().getResources().getDisplayMetrics().density;
                int wpx = Math.round((float) (w * 96 * density));
                int hpx = Math.round((float) (h * 96 * density));
                wv.measure(View.MeasureSpec.makeMeasureSpec(wpx, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(hpx, View.MeasureSpec.EXACTLY));
                wv.layout(0, 0, wpx, hpx);
                final WebViewClient parent = Build.VERSION.SDK_INT >= 26
                        ? getBridge().getWebView().getWebViewClient() : null;
                final AtomicBoolean started = new AtomicBoolean(false);
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        if (parent != null) {
                            try {
                                return parent.shouldInterceptRequest(view, request);
                            } catch (Exception e) {
                                return null;
                            }
                        }
                        return null;
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (!started.compareAndSet(false, true)) return;
                        final Handler main = new Handler(Looper.getMainLooper());
                        main.postDelayed(() -> {
                            try {
                                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                                final PrintJob job = pm.print(jobName, wv.createPrintDocumentAdapter(jobName), attrs);
                                final AtomicBoolean answered = new AtomicBoolean(false);
                                final long deadline = System.currentTimeMillis() + 900000;
                                final Runnable[] poll = new Runnable[1];
                                poll[0] = () -> {
                                    boolean canceled = job.isCancelled();
                                    boolean failed = job.isFailed();
                                    boolean done = job.isCompleted();
                                    boolean active = job.isStarted() || job.isQueued() || job.isBlocked() || done;
                                    if (!answered.get()) {
                                        if (canceled) {
                                            answered.set(true);
                                            JSObject r = new JSObject();
                                            r.put("ok", false);
                                            r.put("canceled", true);
                                            call.resolve(r);
                                        } else if (failed) {
                                            answered.set(true);
                                            call.reject("Print job failed");
                                        } else if (active) {
                                            answered.set(true);
                                            JSObject r = new JSObject();
                                            r.put("ok", true);
                                            call.resolve(r);
                                        }
                                    }
                                    if (canceled || failed || done || System.currentTimeMillis() > deadline) {
                                        if (!answered.getAndSet(true)) call.reject("Print timed out");
                                        wv.destroy();
                                        return;
                                    }
                                    main.postDelayed(poll[0], 700);
                                };
                                main.postDelayed(poll[0], 500);
                            } catch (Exception e) {
                                wv.destroy();
                                call.reject(String.valueOf(e.getMessage()));
                            }
                        }, printDelayMs);
                    }
                });
                wv.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }
}
