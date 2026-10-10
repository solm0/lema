# Vendored Android libraries

`kiwi-android-v0.24.0.aar` is the official Kiwi Android release used by
`KoreanNlpAnalyzer`.

- Source: https://github.com/bab2min/Kiwi/releases/tag/v0.24.0
- License: Apache-2.0
- SHA-256: `006beced1a38fd0b07603e728fb348d71f263d5bb25463b1238e6789b54a281f`

The Korean model is not bundled in the APK. During Korean language-pack
installation the app downloads the matching `kiwi_model_v0.24.0_base.tgz`,
verifies SHA-256
`33188ba932bba4717bad5244bbec0ef8b1c9cbb47e26e68394a7976d8d779083`, and
extracts the required base-model files into `models/kiwi/`.
