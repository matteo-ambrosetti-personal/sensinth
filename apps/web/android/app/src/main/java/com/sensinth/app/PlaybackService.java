package com.sensinth.app;

import android.Manifest;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the music going with the screen off or another app in front. Android freezes an app that
 * leaves the screen unless it runs a foreground service, so while the music plays this service
 * shows a "Sensinth is playing" notification (with Stop) and holds a partial wake lock, so the
 * processor, the sensors and the audio keep running.
 *
 * <p>Started by {@link PlaybackPlugin} when you press Play, ended when you press Stop in the app
 * or in the notification, or when you swipe the app away.
 */
public class PlaybackService extends Service {

    static final String ACTION_PLAY = "com.sensinth.app.action.PLAY";
    /** From the app's own Stop: end quietly. */
    static final String ACTION_QUIT = "com.sensinth.app.action.QUIT";
    /** From the notification's Stop: tell the app, then end. */
    static final String ACTION_STOP = "com.sensinth.app.action.STOP";

    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 1;
    /** A wake lock is never held forever: six hours of music at most without opening the app. */
    private static final long WAKE_LOCK_MS = 6L * 60 * 60 * 1000;

    /** Told when the notification's Stop is pressed. */
    interface Listener {
        void onStopRequested();
    }

    static volatile Listener listener;
    /** True from the moment the app asks for the service until it ends. */
    private static volatile boolean active = false;

    private PowerManager.WakeLock wakeLock;

    static boolean isActive() {
        return active;
    }

    static void markStarting() {
        active = true;
    }

    static void markStopped() {
        active = false;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManagerCompat.from(this).createNotificationChannel(
            new NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
                .setName("Playing")
                .setDescription("Shown while the music plays, so it keeps going with the screen off")
                .setShowBadge(false)
                .build()
        );
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        // Every start must reach startForeground, even one that only stops: Android ends an app
        // whose foreground service stops before it has shown its notification.
        if (!goForeground()) return START_NOT_STICKY;
        if (ACTION_STOP.equals(action)) {
            Listener l = listener;
            if (l != null) l.onStopRequested();
            shutdown();
        } else if (ACTION_QUIT.equals(action)) {
            shutdown();
        } else {
            active = true;
            holdWakeLock();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        active = false;
        releaseWakeLock();
        super.onDestroy();
    }

    /** Shows the notification; false when Android does not allow it now. */
    private boolean goForeground() {
        Notification notification = notification();
        int types = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        }
        // With the microphone allowed, it keeps hearing the room in the background too.
        int withMic = types;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && granted(Manifest.permission.RECORD_AUDIO)) {
            withMic |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, withMic);
            return true;
        } catch (RuntimeException e) {
            try {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types);
                return true;
            } catch (RuntimeException again) {
                // Not allowed now (Android refuses some starts): the music plays while the app is open.
                active = false;
                stopSelf();
                return false;
            }
        }
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openApp = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop = new Intent(this, PlaybackService.class).setAction(ACTION_STOP);
        PendingIntent stopMusic = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_sensinth)
            .setContentTitle("Sensinth is playing")
            .setContentText("The music keeps going with the screen off. Tap to open.")
            .setContentIntent(openApp)
            .addAction(0, "Stop", stopMusic)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void holdWakeLock() {
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            if (power == null) return;
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sensinth:playback");
            wakeLock.setReferenceCounted(false);
        }
        wakeLock.acquire(WAKE_LOCK_MS);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private void shutdown() {
        active = false;
        releaseWakeLock();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }
}
