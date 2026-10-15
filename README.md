# Lema Monorepo

이 저장소는 여러 실행 표면이 한 repo 안에 함께 있는 멀티앱 구조입니다.

- `backend`: Electron과 로컬 워크플로우가 쓰는 로컬 FastAPI 서버
- `central`: 계정, 공유 콘텐츠, 모바일 API, 랜딩 페이지를 담당하는 중앙 FastAPI 서버
- `frontend`: 메인 Vite React 앱, Capacitor 모바일 앱, 랜딩 빌드, Chrome extension 빌드
- `electron`: 데스크톱 셸, 로컬 백엔드 실행, 딥링크, 로컬 now-playing 연동
- `shared`: 중앙/로컬 서버에서 재사용하거나 동기화하는 Python 서비스 로직
- `preprocess`: 코퍼스 전처리 스크립트
- `releases`: 언어별 데이터와 배포 아티팩트

## Where to start

작업 범위를 먼저 좁히는 것이 중요합니다.

- 로컬 분석, lemma lookup, 로컬 API 이슈: `backend`
- 로그인, 공유 페이지, 모바일 클라우드 API: `central`
- 웹 UI, 모바일 UI, extension UI: `frontend`
- 데스크톱 앱 부팅, 패키징, 딥링크, 플레이어 연동: `electron`
- 양쪽 서버에서 공통으로 보이는 언어 처리 이슈: `shared`
- 데이터 생성 파이프라인: `preprocess`, 필요 시 `releases`

Codex용 운영 가이드는 각 폴더의 `AGENTS.md`를 참고하면 됩니다.

## App boundaries

- Electron은 계속 로컬 언어 백엔드를 사용합니다.
  - 기본 로컬 API 기준: `http://localhost:8000/api`
- Mobile은 계정 및 어휘 상태 동기화에만 중앙 API를 사용합니다.
  - 분석과 lookup은 설치된 기기 언어 팩에서 수행하며, 중앙 서버로 텍스트를 보내지 않습니다.
- 웹 랜딩 데모의 동적 영어 lemma 확장만 중앙의 읽기 전용 영어 SQLite 조회 API를 사용합니다. 분석 기능이나 다른 언어 팩은 중앙에 두지 않습니다.
- Electron/macOS는 AppleScript로 데스크톱 플레이어의 now-playing 정보를 로컬에서 읽습니다.
- Android는 active media session 기반으로 now-playing을 읽으며 notification access가 필요합니다.

## Key entrypoints

- `backend/main.py`: 로컬 API 엔트리포인트
- `central/main.py`: 중앙 API 엔트리포인트
- `frontend/package.json`: 메인 프론트엔드 및 Capacitor 스크립트
- `frontend/src`: 메인 UI 소스
- `electron/main.js`: Electron 메인 프로세스

## Frontend scripts

`frontend/package.json` 기준 주요 명령:

- `npm run dev`
- `npm run build`
- `npm run build:extension`
- `npm run build:landing`
- `npm run cap:sync`
- `npm run cap:run:android`
- `npm run cap:run:ios`

## Release and versioning

릴리스는 데스크톱과 안드로이드를 분리해서 관리합니다.

- Desktop 태그: `app-desktop-vX.Y.Z`
- Android 태그: `app-android-vX.Y.Z`

GitHub Actions는 태그별로 서로 다른 워크플로우를 실행합니다.

- Desktop: `.github/workflows/electron-build.yml`
- Android: `.github/workflows/android-build.yml`

배포 버전 숫자도 플랫폼별로 따로 관리합니다.

- Desktop 버전 기준: `electron/package.json`
- Android 버전 기준: `frontend/package.json`

버전 동기화 스크립트는 `scripts/sync-app-version.mjs`입니다.

- Desktop 버전은 `central/static/latest-version-desktop.json`에 반영됩니다.
- Android 버전은 `frontend/android/app/build.gradle`의 `versionCode`, `versionName`과 `central/static/latest-version-android.json`에 반영됩니다.
- Electron 빌드 시에는 `APP_VERSION_OVERRIDE`로 데스크톱 버전이 프론트 설정 페이지에 주입됩니다.

최신 버전 API는 플랫폼별 JSON을 읽습니다.

- Desktop: `GET /api/latest-version?platform=desktop`
- Android: `GET /api/latest-version?platform=android`

프론트는 실행 플랫폼을 보고 자동으로 적절한 최신 버전 정보를 요청합니다.

권장 릴리스 순서:

1. Android 배포면 `frontend/package.json`의 `version`을 올립니다.
2. Desktop 배포면 `electron/package.json`의 `version`을 올립니다.
3. `node scripts/sync-app-version.mjs`를 실행합니다.
4. 커밋 후 알맞은 태그를 만듭니다.
5. 태그 push로 GitHub Actions와 Hugging Face 업로드를 실행합니다.

예:

```bash
node scripts/sync-app-version.mjs
git tag app-android-v1.2.0
git push origin app-android-v1.2.0
```

```bash
node scripts/sync-app-version.mjs
git tag app-desktop-v1.3.0
git push origin app-desktop-v1.3.0
```

## Android signing

Android APK를 직접 배포하려면 release signing이 필요합니다.

keystore 파일은 바이너리라서 편집기로 열면 깨진 글자처럼 보이는 것이 정상입니다. 이 파일 자체를 Git에 커밋하지 말고, base64로 인코딩한 텍스트를 GitHub Secret으로 저장해야 합니다.

keystore 생성 예:

```bash
keytool -genkeypair -v -keystore lema-release.keystore -alias lema -keyalg RSA -keysize 2048 -validity 10000
```

base64 문자열은 아래 명령의 출력값입니다.

```bash
base64 -i lema-release.keystore
```

macOS에서 바로 클립보드로 보내려면:

```bash
base64 -i lema-release.keystore | pbcopy
```

파일로 저장해서 확인하려면:

```bash
base64 -i lema-release.keystore > lema-release.keystore.base64.txt
```

GitHub 저장소 `Settings -> Secrets and variables -> Actions`에 아래 Secret을 추가합니다.

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Android workflow는 Secret이 모두 있으면 signed APK를 만들고, 없으면 unsigned APK를 만듭니다.

## Environment notes

중앙 API/모바일 분리 이후 기준 환경변수:

- Central
  - `PUBLIC_API_BASE_URL`: 공개 중앙 API base URL, 예: `https://api.example.com/api`
- Frontend
  - `VITE_ELECTRON_CENTRAL_API`
  - `VITE_ELECTRON_LOCAL_API`
  - `VITE_MOBILE_CENTRAL_API`

계정 이메일 인증과 비밀번호 재설정 페이지는 중앙 API 도메인에서 직접 서빙합니다.

## Data and packs

- 언어 팩 정의는 `shared/manifests/language_packs.py`에 두며, Electron은 이를 로컬 백엔드에서 읽고 Android 카탈로그는 빌드 때 생성합니다.
- 가사 페이지는 한 줄당 한 block을 저장합니다.
- 각 block은 이후 재생 동기화를 위해 `timestamp_ms`를 가질 수 있습니다.
- 트랙 메타데이터가 있으면 클라이언트에서 LRCLIB 기반으로 가사를 매칭합니다.

## Working in this repo

- 이 repo는 앱이 여러 개라서 전체를 한 번에 읽기보다, 작업 대상 폴더 하나와 필요 시 `shared`만 보는 편이 훨씬 효율적입니다.
- `node_modules`, 빌드 결과물, 생성 데이터는 해당 작업이 아니면 기본적으로 무시하는 것이 좋습니다.
- `frontend/frontend`는 중첩 패키지이므로 메인 앱으로 단정하지 말고, 작업이 명시적으로 가리킬 때만 확인하세요.
