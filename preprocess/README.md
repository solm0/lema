# 언어팩 생성하기
- 전체생성: `source backend/venv/bin/activate` -> `python3 preprocess/run_all_builds.py --version 0.0.0 --jobs 3 --caffeinate`
- 일부 생성: `--lang ko --lang ja`
- 전체 업로드: `python3 preprocess/publish_releases.py --version 0.0.0`

# 같은 태그로 다시 배포하기
git tag -d app-desktop-v0.0.0
git push origin :refs/tags/app-desktop-v0.0.0
git tag app-desktop-v0.0.0
git push origin app-desktop-v0.0.0

git tag -d app-android-v0.0.0
git push origin :refs/tags/app-android-v0.0.0
git tag app-android-v0.0.0
git push origin app-android-v0.0.0

# 모바일 분석기 품질 검사
- Android 결과와 Electron/언어팩 DB 비교: `python3 preprocess/analyzer_quality/compare.py --help`
- 입력 형식과 언어별 설정: `preprocess/analyzer_quality/README.md`
