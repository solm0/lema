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