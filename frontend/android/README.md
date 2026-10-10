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

## Android 언어팩

표준 APK에는 OpenNLP 실행 코드와 한국어용 Kiwi Android AAR만 포함하고 SQLite와 언어별
모델은 포함하지 않는다. 영어·독일어·러시아어는 OpenNLP 모델을 사용한다. 한국어는
Electron의 `kiwipiepy`와 같은 계열인 Kiwi 0.24를 사용한다. 한국어 팩 설치 시 공식
`kiwi_model_v0.24.0_base.tgz`를 SHA-256으로 검증하고 `models/kiwi/`에 압축 해제한다.
설치한 파일은 Electron의 사용자 데이터 폴더와 같은 역할을 하는 Android 앱 전용 폴더
`filesDir/language-packs/<lang>/<version>`에 저장한다. 폴더 안에는
`lemma_pack.db`와 `models/`가 함께 있어야 설치 완료로 판단한다.

Kiwi CoNg 모델은 네이티브 메모리를 많이 사용하므로 한국어 분석기는 연속 분석 중에는
재사용하되 마지막 사용 30초 후 닫는다. 한국어 성능 측정에서는 Java heap뿐 아니라
native/total PSS도 함께 확인해야 한다. Samsung SM-S906N 기준 1,000문장 품질 게이트는
통과했지만 peak total PSS가 약 766MB여서 성능 기준선에는 이 제한을 명시적으로 남긴다.

영어 언어팩의 실제 다운로드·검증·삭제를 연결된 기기에서 확인하려면 다음 opt-in
계측 테스트를 실행한다. runner 인수를 생략한 일반 계측 테스트에서는 다운로드를 건너뛴다.

```sh
./gradlew :app:connectedStandardDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.solmi.lema.AndroidLanguagePackStoreInstrumentedTest \
  -Pandroid.testInstrumentationRunnerArguments.runLanguagePackDownloadTest=true
```

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
