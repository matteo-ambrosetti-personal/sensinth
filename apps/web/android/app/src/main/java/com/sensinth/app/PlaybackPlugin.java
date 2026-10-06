package com.sensinth.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Lets the web app keep playing in the background: {@code start()} at Play runs
 * {@link PlaybackService}, {@code stop()} at Stop ends it. Pressing Stop in the notification sends a
 * "stopRequested" event, so the app stops the music too.
 *
 * <p>The first Play on Android 13 and later asks once to show notifications; the music plays in
 * the background either way, only the notification needs it.
 */
@CapacitorPlugin(
    name = "Playback",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class PlaybackPlugin extends Plugin {

    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        PlaybackService.listener = () ->
            handler.post(() -> {
                notifyListeners("stopRequested", new JSObject());
                sensorsStopped();
            });
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "afterNotifications");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        begin(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (PlaybackService.isActive()) {
            Intent quit = new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.ACTION_QUIT);
            try {
                getContext().startService(quit);
            } catch (RuntimeException e) {
                getContext().stopService(new Intent(getContext(), PlaybackService.class));
            }
        }
        sensorsStopped();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService.listener = null;
        if (PlaybackService.isActive()) getContext().stopService(new Intent(getContext(), PlaybackService.class));
    }

    private void begin(PluginCall call) {
        Intent play = new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.ACTION_PLAY);
        try {
            PlaybackService.markStarting();
            ContextCompat.startForegroundService(getContext(), play);
            call.resolve();
        } catch (RuntimeException e) {
            PlaybackService.markStopped();
            call.reject("The music can't keep playing in the background: " + e.getMessage());
        }
    }

    /** With the music stopped while the app is away, the phone's sensors can rest too. */
    private void sensorsStopped() {
        PluginHandle sensors = getBridge().getPlugin("NativeSensors");
        if (sensors != null && sensors.getInstance() instanceof SensorsPlugin) {
            ((SensorsPlugin) sensors.getInstance()).playbackStopped();
        }
    }
}
