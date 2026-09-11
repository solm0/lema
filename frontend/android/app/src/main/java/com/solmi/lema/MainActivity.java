package com.solmi.lema;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile boolean isInForeground = false;

    public static boolean isAppInForeground() {
        return isInForeground;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NowPlayingPlugin.class);
        registerPlugin(LemaLibraryPlugin.class);
        super.onCreate(savedInstanceState);
        handleDeepLinkIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        isInForeground = true;
        handleDeepLinkIntent(getIntent());
    }

    @Override
    public void onPause() {
        isInForeground = false;
        super.onPause();
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLinkIntent(intent);
    }

    private void handleDeepLinkIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        String route = intent.getStringExtra("open_route");
        if (route == null || route.isEmpty()) {
            return;
        }

        if (bridge == null || bridge.getWebView() == null) {
            return;
        }

        bridge.getWebView().post(() -> {
            String currentUrl = bridge.getWebView().getUrl();
            String targetUrl = buildTargetUrl(currentUrl, route);
            bridge.getWebView().loadUrl(targetUrl);
        });

        intent.removeExtra("open_route");
    }

    private String buildTargetUrl(String currentUrl, String route) {
        String normalizedRoute = route.startsWith("/") ? route : "/" + route;

        if (currentUrl == null || currentUrl.isEmpty()) {
            return "https://localhost/#" + normalizedRoute;
        }

        int hashIndex = currentUrl.indexOf('#');
        String baseUrl = hashIndex >= 0 ? currentUrl.substring(0, hashIndex) : currentUrl;
        return baseUrl + "#" + normalizedRoute;
    }
}
