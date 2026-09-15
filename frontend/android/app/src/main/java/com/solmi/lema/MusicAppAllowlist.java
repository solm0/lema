package com.solmi.lema;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

final class MusicAppAllowlist {
    private static final Set<String> PACKAGES = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(
            "com.spotify.music",
            "com.google.android.apps.youtube.music",
            "com.apple.android.music",
            "com.sec.android.app.music",
            "com.iloen.melon",
            "com.ktmusic.geniemusic",
            "skplanet.musicmate"
        ))
    );

    private MusicAppAllowlist() {}

    static boolean contains(String packageName) {
        return packageName != null && PACKAGES.contains(packageName);
    }
}
