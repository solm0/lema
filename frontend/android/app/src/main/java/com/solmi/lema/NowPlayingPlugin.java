package com.solmi.lema;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.util.List;

@CapacitorPlugin(name = "NowPlaying")
public class NowPlayingPlugin extends Plugin {
    private static final String PREFERENCES_NAME = "lema_now_playing";
    private static final String NOTIFICATIONS_ENABLED_KEY = "notifications_enabled";

    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = hasNotificationAccess();

        result.put("platform", "android");
        result.put("supported", true);
        result.put("granted", granted);
        result.put("needs_user_action", !granted);

        call.resolve(result);
    }

    @PluginMethod
    public void openPermissionSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void getCurrentTrack(PluginCall call) {
        JSObject result = buildEmptyTrack("android");

        if (!hasNotificationAccess()) {
            call.resolve(result);
            return;
        }

        MediaSessionManager manager = (MediaSessionManager) getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
        ComponentName listener = new ComponentName(getContext(), NowPlayingNotificationListener.class);

        List<MediaController> controllers;
        try {
            controllers = manager.getActiveSessions(listener);
        } catch (SecurityException error) {
            call.resolve(result);
            return;
        }

        MediaController chosen = null;
        for (MediaController controller : controllers) {
            PlaybackState state = controller.getPlaybackState();
            if (state != null && state.getState() == PlaybackState.STATE_PLAYING) {
                chosen = controller;
                break;
            }
        }

        if (chosen == null && !controllers.isEmpty()) {
            chosen = controllers.get(0);
        }

        if (chosen == null) {
            call.resolve(result);
            return;
        }

        MediaMetadata metadata = chosen.getMetadata();
        PlaybackState playbackState = chosen.getPlaybackState();
        if (metadata == null) {
            call.resolve(result);
            return;
        }

        String title = stringOrNull(metadata.getString(MediaMetadata.METADATA_KEY_TITLE));
        String artist = stringOrNull(metadata.getString(MediaMetadata.METADATA_KEY_ARTIST));
        String album = stringOrNull(metadata.getString(MediaMetadata.METADATA_KEY_ALBUM));
        long duration = metadata.getLong(MediaMetadata.METADATA_KEY_DURATION);
        long position = playbackState != null ? playbackState.getPosition() : -1L;
        boolean isPlaying = playbackState != null && playbackState.getState() == PlaybackState.STATE_PLAYING;

        if (title == null || title.isEmpty()) {
            call.resolve(result);
            return;
        }

        JSObject track = new JSObject();
        track.put("id", JSObject.NULL);
        track.put("uri", JSObject.NULL);
        track.put("name", title);
        track.put("album", album != null ? album : JSObject.NULL);
        track.put("image_url", bitmapToDataUrl(
            metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) != null
                ? metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
                : metadata.getBitmap(MediaMetadata.METADATA_KEY_ART)
        ));
        track.put("external_url", JSObject.NULL);
        track.put("isrc", JSObject.NULL);
        track.put("artists", new org.json.JSONArray().put(artist != null ? artist : ""));

        JSObject device = new JSObject();
        device.put("name", android.os.Build.MODEL);
        device.put("type", chosen.getPackageName());

        result.put("available", true);
        result.put("source", chosen.getPackageName());
        result.put("is_playing", isPlaying);
        result.put("progress_ms", position >= 0 ? position : JSObject.NULL);
        result.put("duration_ms", duration > 0 ? duration : JSObject.NULL);
        result.put("timestamp", System.currentTimeMillis());
        result.put("track", track);
        result.put("device", device);
        result.put("source_query", new JSObject());
        result.put("lyrics", JSObject.NULL);

        call.resolve(result);
    }

    @PluginMethod
    public void getNotificationPermissionStatus(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        boolean canRequest = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED;

        result.put("granted", granted);
        result.put("can_request", canRequest);
        call.resolve(result);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void setNowPlayingNotificationsEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required");
            return;
        }

        getContext()
            .getSharedPreferences(PREFERENCES_NAME, android.content.Context.MODE_PRIVATE)
            .edit()
            .putBoolean(NOTIFICATIONS_ENABLED_KEY, enabled)
            .apply();
        call.resolve();
    }

    private boolean hasNotificationAccess() {
        String enabledListeners = Settings.Secure.getString(
            getContext().getContentResolver(),
            "enabled_notification_listeners"
        );

        if (enabledListeners == null) {
            return false;
        }

        String packageName = getContext().getPackageName();
        return enabledListeners.contains(packageName + "/" + NowPlayingNotificationListener.class.getName());
    }

    private JSObject buildEmptyTrack(String source) {
        JSObject result = new JSObject();
        result.put("available", false);
        result.put("source", source);
        result.put("is_playing", false);
        result.put("progress_ms", JSObject.NULL);
        result.put("duration_ms", JSObject.NULL);
        result.put("timestamp", JSObject.NULL);
        result.put("track", JSObject.NULL);
        result.put("device", JSObject.NULL);

        JSObject sourceQuery = new JSObject();
        sourceQuery.put("primary", JSObject.NULL);
        sourceQuery.put("fallbacks", new org.json.JSONArray());
        result.put("source_query", sourceQuery);
        result.put("lyrics", JSObject.NULL);
        return result;
    }

    private String stringOrNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    private String bitmapToDataUrl(Bitmap bitmap) {
        if (bitmap == null) {
            return null;
        }

        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream);
        String base64 = Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP);
        return "data:image/png;base64," + base64;
    }
}
