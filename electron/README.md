# 데스크톱 앱 배포

`app-desktop-v*` 태그를 push하면 GitHub Actions가 macOS, Windows, Linux 설치 파일을 자동으로 빌드하고 Hugging Face에 업로드합니다.

아래 예시는 `1.0.2`에서 `1.0.3`으로 배포하는 경우입니다.

## 1. 버전 올리기

저장소 루트에서 실행합니다.

```bash
npm --prefix electron version 1.0.3 --no-git-tag-version --allow-same-version
node scripts/sync-app-version.mjs
```

다음 파일의 데스크톱 버전이 맞춰집니다.

- `electron/package.json`
- `electron/package-lock.json`
- `central/static/latest-version-desktop.json`

Android 버전은 `frontend/package.json`에서 별도로 관리하므로 데스크톱 배포 때 올리지 않습니다.

## 2. 변경 확인

```bash
git diff -- \
  electron/package.json \
  electron/package-lock.json \
  central/static/latest-version-desktop.json

git status --short
```

세 파일의 버전이 모두 같고, 이번 배포에 들어가면 안 되는 변경이 없는지 확인합니다.

## 3. 커밋하고 main push

버전 파일과 이번 릴리스에 포함할 변경을 커밋합니다.

```bash
git add -A
git commit -m "데스크톱 1.0.3 릴리스"
git push origin main
```

## 4. 태그 push

커밋 후 동일한 버전으로 태그를 만듭니다.

```bash
git tag -a app-desktop-v1.0.3 -m "Desktop 1.0.3"
git push origin app-desktop-v1.0.3
```

태그 이름은 반드시 다음 형식이어야 합니다.

```text
app-desktop-v<electron/package.json의 버전>
```

태그를 로컬에 만들기만 해서는 배포되지 않습니다. 태그 push까지 해야 합니다.

## 5. 빌드 결과 확인

GitHub 저장소의 `Actions` 탭에서 `Build Electron Apps`가 성공했는지 확인합니다.

생성되는 파일:

- macOS: `.dmg`
- Windows: `.exe`
- Linux: `.AppImage`

태그 빌드가 성공하면 결과물이 Hugging Face의 다음 경로에도 업로드됩니다.

```text
releases/desktop/app-desktop-v1.0.3/
```

## 6. 중앙 서버에 최신 버전 반영

앱의 업데이트 확인 API가 새 버전을 표시하도록 운영 서버도 최신 커밋으로 갱신합니다.

```bash
cd /srv/capstone/nautilus
git pull
sudo systemctl restart nautilus
```

확인:

```bash
curl "https://nautilus.solmi.wiki/api/latest-version?platform=desktop"
```

응답의 `version`이 배포한 버전과 같으면 완료입니다.

## 로컬 빌드가 필요한 경우만

보통은 태그를 push해 GitHub Actions로 빌드합니다. 로컬 macOS 설치 파일이 필요할 때만 다음을 실행합니다.

```bash
npm --prefix electron run build:bundle:mac
```

결과물은 `electron/dist-electron`에 생성됩니다.
