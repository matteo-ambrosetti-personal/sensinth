package com.sensinth.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Milliseconds after leaving the screen at which the page is told it is still shown. */
    private static final long[] STAY_VISIBLE_MS = { 300, 1500 };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SensorsPlugin.class);
        registerPlugin(PlaybackPlugin.class);
        super.onCreate(savedInstanceState);
        // The screen stays on while the app is open; with the music playing you can still turn it off.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WebView web = webView();
        if (web != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Keep the page's process as important as the app, shown or not.
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (PlaybackService.isActive()) stayVisible();
    }

    /**
     * When the app leaves the screen, Android tells the page it is hidden, and the browser engine
     * then slows its timers and stops the motion sensors. While the music plays on, tell the page
     * it is still shown, so the music and the sensors keep their pace.
     */
    private void stayVisible() {
        WebView web = webView();
        if (web == null) return;
        for (long delay : STAY_VISIBLE_MS) {
            web.postDelayed(
                () -> {
                    if (PlaybackService.isActive()) web.dispatchWindowVisibilityChanged(View.VISIBLE);
                },
                delay
            );
        }
    }

    private WebView webView() {
        return getBridge() != null ? getBridge().getWebView() : null;
    }
}
