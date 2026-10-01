# Offline exhibition APK

The `gradshow` Android flavor is a separate app (`com.solmi.lema.gradshow`). It
bundles the analyzed English page "Weyes Blood - A Lot's Gonna Change" and the
English lemma pack from `../releases/en/en-v1.1.2/en-v1.1.2-lemma.zip`. The
source page is seeded only when absent. Annotations and metadata use the
device's Room library; lemma state uses the device's Capacitor Preferences.
Nothing is synchronized to an account.

From `frontend`:

```sh
npm run android:gradshow:debug
```

Install `android/app/build/outputs/apk/gradshow/debug/app-gradshow-debug.apk`
on the exhibition device. With USB debugging enabled, use:

```sh
adb install -r android/app/build/outputs/apk/gradshow/debug/app-gradshow-debug.apk
```

For a signed release, set `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`,
then run:

```sh
npm run android:gradshow:release
```

The release artifact is
`android/app/build/outputs/apk/gradshow/release/app-gradshow-release.apk`.
Do not distribute a release build unless those signing variables were set and
the APK was signed. Keep the same keystore for updates that preserve local
annotations and lemma state.

The APK is about 47 MB. On first lemma lookup the bundled ZIP is extracted to
the app's private storage (about 314 MB); allow at least 500 MB free on the
device. The first lookup can be slower. Verify the page, lemma expansion,
chain examples, known-word marking, annotation editing, metadata editing, and
navigation in airplane mode before the exhibition. Android's system Home
gesture is not blocked; use device screen pinning or kiosk configuration if
visitors must stay in the app.

The normal Android app is built as `standard` (`:app:assembleStandardDebug` or
`:app:assembleStandardRelease`). Its package, permissions and data are
separate. Avoid `npx cap sync android` after building the exhibition web bundle:
Capacitor sync updates the normal app's `src/main/assets/public`. The gradshow
Gradle task reads `dist-gradshow` directly, so no sync is needed for it.
