package app.sidekick.organiser;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

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
import java.util.UUID;

/**
 * "Share to Sidekick": receives text, links, photos and files from other apps' share menus.
 * Shared files are copied into this app's private cache (they never leave the phone here); the web side
 * reads them, lets the person choose where they go, and uploads them through the normal queue.
 */
@CapacitorPlugin(name = "ShareIn")
public class ShareInPlugin extends Plugin {
    private static final long MAX_BYTES = 50L * 1024 * 1024; // same limit as uploads
    private static JSObject pending;
    private static ShareInPlugin instance;

    @Override
    public void load() { instance = this; }

    /** Called by MainActivity for the launch intent and for every new one while running. */
    static void handle(Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        JSObject share = new JSObject();
        share.put("text", intent.getStringExtra(Intent.EXTRA_TEXT));
        share.put("subject", intent.getStringExtra(Intent.EXTRA_SUBJECT));
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) uris.add(one);
        } else {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }
        JSArray files = new JSArray();
        for (Uri uri : uris) {
            JSObject f = copy(ctx, uri);
            if (f != null) files.put(f);
        }
        share.put("files", files);
        pending = share;
        // consumed: rotating the phone or reopening must not deliver the same share twice
        intent.setAction(Intent.ACTION_MAIN);
        if (instance != null) instance.notifyListeners("shared", new JSObject(), true);
    }

    private static JSObject copy(Context ctx, Uri uri) {
        String name = "shared-file";
        long size = -1;
        try (Cursor c = ctx.getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int s = c.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0 && c.getString(n) != null) name = c.getString(n);
                if (s >= 0 && !c.isNull(s)) size = c.getLong(s);
            }
        } catch (Exception ignored) { }
        String mime = ctx.getContentResolver().getType(uri);
        JSObject f = new JSObject();
        f.put("name", name);
        f.put("mime", mime == null ? "application/octet-stream" : mime);
        if (size > MAX_BYTES) { f.put("tooBig", true); f.put("size", size); return f; }
        File dir = new File(ctx.getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) return null;
        File out = new File(dir, UUID.randomUUID() + "-" + name.replaceAll("[^A-Za-z0-9._-]", "_"));
        long total = 0;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) return null;
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = in.read(buf)) != -1) {
                total += r;
                if (total > MAX_BYTES) { os.close(); out.delete(); f.put("tooBig", true); f.put("size", total); return f; }
                os.write(buf, 0, r);
            }
        } catch (Exception e) {
            return null;
        }
        f.put("path", out.getAbsolutePath());
        f.put("size", total);
        return f;
    }

    /** Hands over the waiting share once (or nothing). */
    @PluginMethod
    public void take(PluginCall call) {
        JSObject out = new JSObject();
        out.put("share", pending);
        pending = null;
        call.resolve(out);
    }

    /** Deletes the cached copies once they are queued for upload (the queue keeps its own copy). */
    @PluginMethod
    public void clear(PluginCall call) {
        File dir = new File(getContext().getCacheDir(), "shared");
        File[] list = dir.listFiles();
        if (list != null) for (File f : list) f.delete();
        call.resolve();
    }
}
