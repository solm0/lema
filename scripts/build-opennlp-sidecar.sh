#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRADLE_WRAPPER="$ROOT_DIR/frontend/android/gradlew"
PROJECT_DIR="$ROOT_DIR/nlp-java"
OUTPUT_DIR="$ROOT_DIR/desktop-sidecar/dist"
JAVA_BIN="${JAVA_BIN:-$(command -v java)}"
JLINK_BIN="${JLINK_BIN:-$(dirname "$JAVA_BIN")/jlink}"
JAVA_HOME_DIR="$(cd "$(dirname "$JAVA_BIN")/.." && pwd)"
JMODS_DIR="${JMODS_DIR:-$JAVA_HOME_DIR/jmods}"

if [[ ! -x "$GRADLE_WRAPPER" ]]; then
  echo "Android Gradle wrapper is missing: $GRADLE_WRAPPER" >&2
  exit 1
fi
if [[ ! -x "$JLINK_BIN" ]]; then
  echo "jlink was not found; set JLINK_BIN to a JDK's jlink executable" >&2
  exit 1
fi
if [[ ! -d "$JMODS_DIR" ]]; then
  echo "JDK modules directory was not found: $JMODS_DIR; set JMODS_DIR explicitly" >&2
  exit 1
fi

"$GRADLE_WRAPPER" -p "$PROJECT_DIR" :desktop-sidecar:fatJar

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
cp "$PROJECT_DIR/desktop-sidecar/build/libs/lema-opennlp-sidecar-1.0.0.jar" \
  "$OUTPUT_DIR/lema-opennlp-sidecar.jar"
"$JLINK_BIN" \
  --module-path "$JMODS_DIR" \
  --add-modules java.base,java.logging,java.naming,java.xml,jdk.unsupported \
  --strip-debug --no-header-files --no-man-pages --compress=zip-6 \
  --output "$OUTPUT_DIR/runtime"

echo "Desktop OpenNLP sidecar written to: $OUTPUT_DIR"
