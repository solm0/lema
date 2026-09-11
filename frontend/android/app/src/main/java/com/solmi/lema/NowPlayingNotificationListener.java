package com.solmi.lema;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import android.service.notification.NotificationListenerService;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class NowPlayingNotificationListener extends NotificationListenerService {
    private static final String CHANNEL_ID = "now_playing_detected";
    private static final int NOTIFICATION_ID = 42042;
    private static final String PREFERENCES_NAME = "lema_now_playing";
    private static final String NOTIFICATIONS_ENABLED_KEY = "notifications_enabled";

    private final Map<String, MediaController.Callback> callbacks = new HashMap<>();
    private MediaSessionManager mediaSessionManager;
    private String lastAnnouncedTrackKey = null;

    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsChangedListener = controllers -> {
        registerControllerCallbacks(controllers);
        maybeNotifyForCurrentTrack();
    };

    @Override
    public void onCreate() {
        super.onCreate();
        mediaSessionManager = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
        createNotificationChannel();
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();

        if (mediaSessionManager == null) {
            return;
        }

        ComponentName componentName = new ComponentName(this, NowPlayingNotificationListener.class);
        mediaSessionManager.addOnActiveSessionsChangedListener(
            sessionsChangedListener,
            componentName
        );

        try {
            registerControllerCallbacks(mediaSessionManager.getActiveSessions(componentName));
            maybeNotifyForCurrentTrack();
        } catch (SecurityException ignored) {}
    }

    @Override
    public void onListenerDisconnected() {
        unregisterAllCallbacks();

        if (mediaSessionManager != null) {
            mediaSessionManager.removeOnActiveSessionsChangedListener(sessionsChangedListener);
        }

        super.onListenerDisconnected();
    }

    @Override
    public void onDestroy() {
        unregisterAllCallbacks();
        super.onDestroy();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        maybeNotifyForCurrentTrack();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        maybeNotifyForCurrentTrack();
    }

    private void registerControllerCallbacks(List<MediaController> controllers) {
        Map<String, MediaController> activeControllers = new HashMap<>();
        for (MediaController controller : controllers) {
            activeControllers.put(controller.getPackageName(), controller);

            if (callbacks.containsKey(controller.getPackageName())) {
                continue;
            }

            MediaController.Callback callback = new MediaController.Callback() {
                @Override
                public void onMetadataChanged(MediaMetadata metadata) {
                    maybeNotifyForCurrentTrack();
                }

                @Override
                public void onPlaybackStateChanged(PlaybackState state) {
                    maybeNotifyForCurrentTrack();
                }
            };

            controller.registerCallback(callback);
            callbacks.put(controller.getPackageName(), callback);
        }

        callbacks.entrySet().removeIf((entry) -> {
            String packageName = entry.getKey();
            if (activeControllers.containsKey(packageName)) {
                return false;
            }

            MediaController controller = findControllerByPackageName(controllers, packageName);
            if (controller != null) {
                controller.unregisterCallback(entry.getValue());
            }
            return true;
        });
    }

    private void unregisterAllCallbacks() {
        if (mediaSessionManager == null) {
            callbacks.clear();
            return;
        }

        ComponentName componentName = new ComponentName(this, NowPlayingNotificationListener.class);
        List<MediaController> controllers;

        try {
            controllers = mediaSessionManager.getActiveSessions(componentName);
        } catch (SecurityException ignored) {
            callbacks.clear();
            return;
        }

        for (Map.Entry<String, MediaController.Callback> entry : callbacks.entrySet()) {
            MediaController controller = findControllerByPackageName(controllers, entry.getKey());
            if (controller != null) {
                controller.unregisterCallback(entry.getValue());
            }
        }

        callbacks.clear();
    }

    private MediaController findControllerByPackageName(List<MediaController> controllers, String packageName) {
        for (MediaController controller : controllers) {
            if (packageName.equals(controller.getPackageName())) {
                return controller;
            }
        }

        return null;
    }

    private void maybeNotifyForCurrentTrack() {
        if (MainActivity.isAppInForeground()) {
            return;
        }

        if (!getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
                .getBoolean(NOTIFICATIONS_ENABLED_KEY, true)) {
            return;
        }

        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            return;
        }

        MediaController controller = getPreferredController();
        if (controller == null) {
            return;
        }

        PlaybackState playbackState = controller.getPlaybackState();
        if (playbackState == null || playbackState.getState() != PlaybackState.STATE_PLAYING) {
            return;
        }

        MediaMetadata metadata = controller.getMetadata();
        if (metadata == null) {
            return;
        }

        String title = trimToNull(metadata.getString(MediaMetadata.METADATA_KEY_TITLE));
        String artist = trimToNull(metadata.getString(MediaMetadata.METADATA_KEY_ARTIST));
        String album = trimToNull(metadata.getString(MediaMetadata.METADATA_KEY_ALBUM));

        if (title == null) {
            return;
        }

        String trackKey = controller.getPackageName() + "|" + title + "|" + (artist != null ? artist : "") + "|" + (album != null ? album : "");
        if (trackKey.equals(lastAnnouncedTrackKey)) {
            return;
        }

        lastAnnouncedTrackKey = trackKey;
        postNowPlayingNotification(title, artist);
    }

    private MediaController getPreferredController() {
        if (mediaSessionManager == null) {
            return null;
        }

        ComponentName componentName = new ComponentName(this, NowPlayingNotificationListener.class);
        List<MediaController> controllers;

        try {
            controllers = mediaSessionManager.getActiveSessions(componentName);
        } catch (SecurityException ignored) {
            return null;
        }

        for (MediaController controller : controllers) {
            PlaybackState state = controller.getPlaybackState();
            if (state != null && state.getState() == PlaybackState.STATE_PLAYING) {
                return controller;
            }
        }

        return controllers.isEmpty() ? null : controllers.get(0);
    }

    private void postNowPlayingNotification(String title, String artist) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("open_route", "/lyric");
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String body = title + " is playing.";
        String subText = artist != null ? artist : "Tap to open lyrics";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(body)
            .setContentText(subText)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(subText))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, builder.build());
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager notificationManager = getSystemService(NotificationManager.class);
        if (notificationManager == null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Now Playing",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Notifications for detected now playing tracks");
        notificationManager.createNotificationChannel(channel);
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
