package com.solmi.lema;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MusicAppAllowlistTest {
    @Test
    public void allowsSupportedKoreanMusicApps() {
        assertTrue(MusicAppAllowlist.contains("com.iloen.melon"));
        assertTrue(MusicAppAllowlist.contains("com.ktmusic.geniemusic"));
        assertTrue(MusicAppAllowlist.contains("skplanet.musicmate"));
    }

    @Test
    public void allowsSupportedGlobalMusicApps() {
        assertTrue(MusicAppAllowlist.contains("com.spotify.music"));
        assertTrue(MusicAppAllowlist.contains("com.google.android.apps.youtube.music"));
        assertTrue(MusicAppAllowlist.contains("com.apple.android.music"));
        assertTrue(MusicAppAllowlist.contains("com.sec.android.app.music"));
    }

    @Test
    public void rejectsRegularYoutubeAndUnknownApps() {
        assertFalse(MusicAppAllowlist.contains("com.google.android.youtube"));
        assertFalse(MusicAppAllowlist.contains("com.android.chrome"));
        assertFalse(MusicAppAllowlist.contains(null));
    }
}
