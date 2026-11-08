package android.print;

import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/** Lives in android.print because the result callbacks have package-private constructors. */
public class PdfPrintHelper {
    public interface Done {
        void onDone(boolean ok, String error);
    }

    private static void close(ParcelFileDescriptor fd) {
        try {
            fd.close();
        } catch (Exception ignored) {
        }
    }

    public static void write(final PrintDocumentAdapter adapter, final PrintAttributes attrs,
                             final File out, final Done done) {
        final ParcelFileDescriptor fd;
        try {
            fd = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_READ_WRITE
                    | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
        } catch (Exception e) {
            done.onDone(false, String.valueOf(e.getMessage()));
            return;
        }
        try {
            adapter.onStart();
            adapter.onLayout(null, attrs, new CancellationSignal(),
                    new PrintDocumentAdapter.LayoutResultCallback() {
                        @Override
                        public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                            adapter.onWrite(new PageRange[] { PageRange.ALL_PAGES }, fd,
                                    new CancellationSignal(),
                                    new PrintDocumentAdapter.WriteResultCallback() {
                                        @Override
                                        public void onWriteFinished(PageRange[] pages) {
                                            close(fd);
                                            adapter.onFinish();
                                            done.onDone(true, null);
                                        }

                                        @Override
                                        public void onWriteFailed(CharSequence error) {
                                            close(fd);
                                            adapter.onFinish();
                                            done.onDone(false, error == null ? "write failed" : error.toString());
                                        }

                                        @Override
                                        public void onWriteCancelled() {
                                            close(fd);
                                            adapter.onFinish();
                                            done.onDone(false, "write cancelled");
                                        }
                                    });
                        }

                        @Override
                        public void onLayoutFailed(CharSequence error) {
                            close(fd);
                            adapter.onFinish();
                            done.onDone(false, error == null ? "layout failed" : error.toString());
                        }

                        @Override
                        public void onLayoutCancelled() {
                            close(fd);
                            adapter.onFinish();
                            done.onDone(false, "layout cancelled");
                        }
                    }, new Bundle());
        } catch (Exception e) {
            close(fd);
            done.onDone(false, String.valueOf(e.getMessage()));
        }
    }
}
