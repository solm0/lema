## 로컬 디버그 실행

`frontend`에서 실행:

```sh
npx cap run android
```

Capacitor sync 직전에 웹 번들을 다시 빌드한다. 디버그 빌드는
`com.solmi.lema.debug` / **Lema Dev**를 사용해 Play 스토어 앱
(`com.solmi.lema`)과 동시에 설치할 수 있다.
`capacitor.config.ts`에서 기본 Android flavor를 `standard`로 고정했으므로,
예전 `app-debug.apk`가 남아 있어도 실행 대상으로 선택되지 않는다.

## 릴리스

./gradlew bundleStandardRelease

# 안드로이드 새 버전 만들기(signed가 아님)
cd frontend

npm version 1.0.x --no-git-tag-version
npm run sync:version
npm run cap:sync

cd android

## 실제 앱
./gradlew bundleStandardRelease

## Gradshow 데모 앱
- apk: ./gradlew assembleGradshowRelease
-> frontend/android/app/build/outputs/apk/gradshow/release/app-gradshow-release.apk
또는 android studio에서
-> frontend/android/app/gradshow/release

https://huggingface.co/datasets/solm0/nautilus-releases/tree/main/releases/android
에 올려놓기.

## 둘 다 빌드
./gradlew bundleRelease

-> frontend/android/app/build/outputs/bundle/release/app-release.aab




# signed버전만들기
android studio에서 만ㄷ름
- 위치: frontend/android/app/standard/release
