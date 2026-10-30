import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  enrichNowPlayingWithLyrics,
  getNowPlayingBasic,
  getNowPlayingPermissionStatus,
  type NowPlayingPermissionStatus,
  type NowPlayingTrack,
} from "../../nowPlaying";
import { getActiveLyricIndex, parseSyncedLyrics } from "./spotifyLyrics";

function computeProgressMs(track: NowPlayingTrack | null) {
  if (!track || track.progress_ms == null) return null;

  const base = track.progress_ms;
  const duration = track.duration_ms ?? Number.POSITIVE_INFINITY;

  if (!track.is_playing || track.timestamp == null) {
    return Math.min(base, duration);
  }

  const derived = base + (Date.now() - track.timestamp);
  return Math.max(0, Math.min(derived, duration));
}

export function useNowPlaying({
  pollMs = 5_000,
  enabled = true,
}: {
  pollMs?: number;
  enabled?: boolean;
} = {}) {
  const [permission, setPermission] = useState<NowPlayingPermissionStatus | null>(null);
  const [track, setTrack] = useState<NowPlayingTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const didLoadTrackRef = useRef(false);

  const refresh = useCallback(() => {
    didLoadTrackRef.current = false;
    setLoading(true);
    setRefreshToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    (async () => {
      try {
        const nextPermission = await getNowPlayingPermissionStatus();
        if (cancelled) return;
        setPermission(nextPermission);

        if (nextPermission.supported && !nextPermission.granted) {
          setTrack(null);
        }
      } catch {
        if (cancelled) return;
        setPermission(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, refreshToken]);

  useEffect(() => {
    if (!enabled) return;
    if (permission?.supported && !permission.granted) return;

    let cancelled = false;
    let requestId = 0;

    const loadTrack = async () => {
      const currentRequestId = ++requestId;

      try {
        const baseTrack = await getNowPlayingBasic();
        if (cancelled || currentRequestId !== requestId) return;

        setLyricsLoading(Boolean(baseTrack.track));

        setTrack((prev) => {
          if (
            prev?.source === baseTrack.source &&
            prev.track?.uri &&
            prev.track.uri === baseTrack.track?.uri
          ) {
            return {
              ...baseTrack,
              lyrics: prev.lyrics,
            };
          }

          if (
            prev?.track?.isrc &&
            baseTrack.track?.isrc &&
            prev.track.isrc === baseTrack.track.isrc
          ) {
            return {
              ...baseTrack,
              lyrics: prev.lyrics,
            };
          }

          return baseTrack;
        });

        const enrichedTrack = await enrichNowPlayingWithLyrics(baseTrack);
        if (cancelled || currentRequestId !== requestId) return;

        setTrack((prev) => {
          if (
            prev?.source !== baseTrack.source ||
            prev.track?.uri !== baseTrack.track?.uri ||
            prev.track?.id !== baseTrack.track?.id ||
            prev.track?.isrc !== baseTrack.track?.isrc ||
            prev.track?.name !== baseTrack.track?.name
          ) {
            return prev;
          }

          return enrichedTrack;
        });
        setLyricsLoading(false);
      } catch {
        if (cancelled || currentRequestId !== requestId) return;
        setTrack(null);
        setLyricsLoading(false);
      } finally {
        if (!cancelled) {
          didLoadTrackRef.current = true;
          setLoading(false);
        }
      }
    };

    if (!didLoadTrackRef.current) {
      setLoading(true);
    }
    loadTrack();
    const intervalId = window.setInterval(loadTrack, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled, permission?.granted, permission?.supported, pollMs, refreshToken]);

  useEffect(() => {
    if (!enabled || !track?.is_playing) return;

    const intervalId = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, track?.is_playing, track?.timestamp]);

  const progressMs = useMemo(() => computeProgressMs(track), [track, tick]);
  const syncedLines = useMemo(
    () => parseSyncedLyrics(track?.lyrics?.synced),
    [track?.lyrics?.synced],
  );
  const activeLyricIndex = useMemo(
    () => getActiveLyricIndex(syncedLines, progressMs),
    [progressMs, syncedLines],
  );

  return {
    loading,
    permission,
    track,
    progressMs,
    syncedLines,
    activeLyricIndex,
    lyricsLoading,
    hasTrack: Boolean(track?.track),
    refresh,
  };
}
