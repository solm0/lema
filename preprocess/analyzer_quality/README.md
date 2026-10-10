# Analyzer quality gate

Android 분석 결과가 기존 Electron 언어팩 데이터와 얼마나 호환되는지 언어에 관계없이 비교한다.
비교기는 모델을 직접 실행하지 않는다. Electron/기존 파이프라인과 Android가 같은 표본을 각각
분석해 JSONL로 내보내면 이 도구가 공통 지표를 계산한다. 모델 실행을 분리했기 때문에 OpenNLP,
Stanza, Classla, Kiwi 등 서로 다른 런타임에도 같은 비교기를 쓸 수 있다.

## 입력

각 JSONL 줄에는 표본 식별자와 토큰이 있어야 한다.

```json
{"id":"17","tokens":[{"surface":"Dogs","lemma":"dog","pos":"NOUN"}]}
```

`id` 대신 `line_id` 또는 `sample_id`를 사용할 수 있다. `tokens` 대신 앱 API와 같은
`blocks[].tokens` 또는 `result.blocks[].tokens`도 허용한다. 한국어와 일본어처럼 `morphs`가
있는 토큰은 `morphs`를 비교 및 검색 단위로 사용한다.

기존 `lemma_pack.db`를 기준으로 삼을 때 candidate의 숫자 ID와 `lines.line_id`가 같아야 한다.

## 실행

```bash
python3 preprocess/analyzer_quality/compare.py \
  --reference-db releases/en/en-v1.1.2/lemma_pack.db \
  --candidate /tmp/en-android.jsonl \
  --config preprocess/analyzer_quality/configs/en.json \
  --json-out /tmp/en-quality.json \
  --mismatches-out /tmp/en-mismatches.json
```

두 JSONL을 직접 비교할 수도 있다.

```bash
python3 preprocess/analyzer_quality/compare.py \
  --reference /tmp/de-electron.jsonl \
  --candidate /tmp/de-android.jsonl \
  --config /tmp/de-quality-config.json
```

출시 자동 검사에서는 최저 기준을 지정한다. 값의 단위는 퍼센트이며 하나라도 미달하면 종료
코드 1을 반환한다.

```bash
python3 preprocess/analyzer_quality/compare.py \
  --reference-db releases/en/en-v1.1.2/lemma_pack.db \
  --candidate /tmp/en-android.jsonl \
  --min-surface-exact 99 \
  --min-annotation-exact 80 \
  --min-db-hit 80
```

## 지표

- `Exact surface sequences`: 문장의 표면 토큰 배열이 완전히 같은 비율
- `Aligned surface tokens`: 토큰화가 달라도 같은 표면 토큰으로 정렬된 비율
- `Exact lemma+POS content tokens`: 정렬된 내용어의 lemma와 품사가 기존 분석과 같은 비율
- `Pack DB hits`: Android가 만든 `lemma_POS`가 기존 SQLite에 존재하는 비율

언어별 설정에는 Unicode 정규화, lemma 대소문자 통일, 양쪽 품사/lemma 대응표와 제외
품사/lemma를 넣을 수 있다. 분석기 고유 보정은 Android 어댑터에서 수행하고, 이 설정은 그
보정안을 실험하거나 서로 다른 태그셋을 비교하는 데 사용한다.

## Android 실기기에서 기준선 만들기

USB 디버깅으로 연결된 기기에서 영어 분석기를 1,000문장 실행하고 비교 결과를
`baselines/en-android-opennlp.json`에 저장한다.

```bash
python3 preprocess/analyzer_quality/run_android.py --language en --sample-size 1000
```

독일어는 같은 실행기에 `--language de`를 지정한다. OpenNLP의 UD German GSD
분석 결과는 기존 spaCy 기반 언어팩의 `lemma_POS`가 없을 때만 DB에 존재하는
품사·표기 대체 후보를 적용한다.

```bash
python3 preprocess/analyzer_quality/run_android.py --language de --sample-size 1000
```

러시아어도 OpenNLP UD Russian GSD 모델을 사용하되, spaCy와 pymorphy3로 생성한
언어팩의 lemma와 비교한다. 어댑터는 `ё/е`, 고유명사 surface, NOUN/PROPN 대체 후보가
SQLite 언어팩에 실제로 존재할 때만 적용한다.

```bash
python3 preprocess/analyzer_quality/run_android.py --language ru --sample-size 1000
```

한국어는 공식 Kiwi 모델 아카이브를 테스트 APK에만 임시로 포함해 Android Kiwi와
`kiwipiepy`로 생성한 언어팩의 형태소 배열을 비교한다. 표준 APK에는 모델이 포함되지 않는다.

```bash
python3 preprocess/analyzer_quality/run_android.py \
  --language ko \
  --sample-size 1000 \
  --kiwi-model-archive /path/to/kiwi_model_v0.24.0_base.tgz
```

이 실행기는 Gradshow Debug 앱을 별도 패키지로 설치하므로 일반 Debug 앱의 로컬 페이지에는
영향을 주지 않는다. 새 언어를 추가할 때는 Android 계측 테스트에 해당 분석기 어댑터를 넣고,
`run_android.py`의 언어 설정과 `configs/{lang}.json`만 추가한다. 비교 및 판정 코드는 바꾸지 않는다.

기존 DB에는 원문의 공백 정보가 없으므로 이 검사는 기준 토큰의 `surface`를 한 칸씩 띄워 입력을
재구성한다. 따라서 언어팩과의 lemma/품사/검색 호환성을 재현하는 검사이며, 실제 가사 문장에 대한
체감 품질 검사는 별도로 유지한다.

## Android 실기기 성능 측정

모델을 처음 메모리에 올리는 시간, 로드 후 유지되는 Java 힙, 12단어 문장 100회 분석 평균을
각각 측정한다. 한국어는 Kiwi 네이티브 할당을 확인하도록 native PSS와 total PSS도 기록한다.
기본적으로 테스트 프로세스를 세 번 새로 시작하고 중앙값과 최솟값·최댓값을
`baselines/en-android-opennlp-performance.json`에 저장한다.

```bash
python3 preprocess/analyzer_quality/run_android_performance.py --language en
```

독일어 모델은 `--language de`, 러시아어 모델은 `--language ru`로 같은
로드·힙·지연 지표를 측정한다.

```bash
python3 preprocess/analyzer_quality/run_android_performance.py \
  --language ko \
  --kiwi-model-archive /path/to/kiwi_model_v0.24.0_base.tgz \
  --max-load-ms 5000 \
  --max-native-pss-mb 250 \
  --max-total-pss-mb 300 \
  --max-analysis-average-ms 25
```

APK가 이미 최신이면 빌드와 설치를 생략할 수 있다.

```bash
python3 preprocess/analyzer_quality/run_android_performance.py \
  --language en \
  --skip-build \
  --runs 3 \
  --iterations 100
```

회귀 검사로 사용할 때는 허용 상한을 지정한다. 중앙값이 하나라도 상한을 넘으면 종료 코드 1을
반환한다.

```bash
python3 preprocess/analyzer_quality/run_android_performance.py \
  --max-load-ms 3000 \
  --max-heap-mb 30 \
  --max-analysis-average-ms 25
```
