#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"
GRADLE_WRAPPER="$ROOT_DIR/frontend/android/gradlew"
PROJECT_DIR="$ROOT_DIR/nlp-java"
OUTPUT_DIR="$ROOT_DIR/desktop-sidecar/dist"
if [[ -n "${JAVA_BIN:-}" ]]; then
  JAVA_BIN="$JAVA_BIN"
elif [[ -x "/opt/homebrew/opt/openjdk@21/bin/java" ]]; then
  # Android Studio's bundled runtime can compile the sidecar but does not ship
  # jmods. Prefer a complete Homebrew JDK when available on Apple Silicon.
  JAVA_BIN="/opt/homebrew/opt/openjdk@21/bin/java"
else
  JAVA_BIN="$(command -v java)"
fi
JLINK_BIN="${JLINK_BIN:-$(dirname "$JAVA_BIN")/jlink}"
JAVA_HOME_DIR="$(cd "$(dirname "$JAVA_BIN")/.." && pwd)"
if [[ ! -d "$JAVA_HOME_DIR/jmods" && -d "$JAVA_HOME_DIR/libexec/openjdk.jdk/Contents/Home/jmods" ]]; then
  # Homebrew's macOS formula exposes java/bin at the keg root but keeps the
  # complete JDK bundle one level below libexec.
  JAVA_HOME_DIR="$JAVA_HOME_DIR/libexec/openjdk.jdk/Contents/Home"
fi
JMODS_DIR="${JMODS_DIR:-$JAVA_HOME_DIR/jmods}"
KIWI_VERSION="0.24.0"
KIWI_DIR="$PROJECT_DIR/desktop-sidecar/libs"
KIWI_JAR="$KIWI_DIR/kiwi-java.jar"

if [[ -z "$TARGET" ]]; then
  echo "usage: scripts/build-opennlp-sidecar.sh <mac|win|linux>" >&2
  exit 1
fi

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

case "$TARGET:$(uname -m)" in
  mac:arm64|mac:aarch64)
    KIWI_ASSET="kiwi-java-v${KIWI_VERSION}-mac-arm64.jar"
    KIWI_SHA256="6ac00bb59f487eb0f82c9677a0e23cb0bc8dfb26543dedae6973ad6d95cb3e90"
    ;;
  mac:x86_64)
    KIWI_ASSET="kiwi-java-v${KIWI_VERSION}-mac-x86_64.jar"
    KIWI_SHA256="f8e0a8018dc3c9e4e3c18bf63438165a06eb760e59d40eb3d144dfe8c3d7d269"
    ;;
  win:x86_64|win:amd64)
    KIWI_ASSET="kiwi-java-v${KIWI_VERSION}-win-x64.jar"
    KIWI_SHA256="96826c15715167c35fe5873d98b4e23871d03d70064b471082750296cbc64ae3"
    ;;
  linux:x86_64|linux:amd64)
    KIWI_ASSET="kiwi-java-v${KIWI_VERSION}-lnx-x86-64.jar"
    KIWI_SHA256="36b5d3ade43317880a5e9886e4f95d6c81d80bd4b71b58788af75984b7932a46"
    ;;
  linux:arm64|linux:aarch64)
    KIWI_ASSET="kiwi-java-v${KIWI_VERSION}-lnx-aarch64.jar"
    KIWI_SHA256="fd456a5ae8a67f2bef8c4d8ca878dd5f56dff8b1bf1fa212ab1937a91adf1c9b"
    ;;
  *)
    echo "unsupported Kiwi Java target: $TARGET/$(uname -m)" >&2
    exit 1
    ;;
esac

verify_sha256() {
  local expected_sha256="$1"
  local file_path="$2"
  local actual_sha256

  # GitHub's Windows runners execute this script through Git Bash, which does
  # not provide macOS's `shasum`. Use the Windows-native implementation there
  # rather than making the package build depend on an extra Unix utility.
  if [[ "$TARGET" == "win" ]]; then
    powershell.exe -NoProfile -Command \
      '$actual = (Get-FileHash -LiteralPath $args[0] -Algorithm SHA256).Hash; if ($actual.ToLowerInvariant() -ne $args[1].ToLowerInvariant()) { exit 1 }' \
      "$file_path" "$expected_sha256"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual_sha256="$(sha256sum "$file_path" | awk '{print $1}')"
    [[ "$actual_sha256" == "$expected_sha256" ]]
  elif command -v shasum >/dev/null 2>&1; then
    actual_sha256="$(shasum -a 256 "$file_path" | awk '{print $1}')"
    [[ "$actual_sha256" == "$expected_sha256" ]]
  else
    echo "No SHA-256 checksum utility found (need sha256sum or shasum)." >&2
    return 1
  fi
}

mkdir -p "$KIWI_DIR"
if [[ ! -f "$KIWI_JAR" ]] || ! verify_sha256 "$KIWI_SHA256" "$KIWI_JAR" >/dev/null 2>&1; then
  temporary_kiwi="$KIWI_JAR.partial"
  rm -f "$temporary_kiwi"
  curl --fail --location --retry 3 --output "$temporary_kiwi" \
    "https://github.com/bab2min/Kiwi/releases/download/v${KIWI_VERSION}/${KIWI_ASSET}"
  verify_sha256 "$KIWI_SHA256" "$temporary_kiwi"
  mv "$temporary_kiwi" "$KIWI_JAR"
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

echo "Desktop Java NLP sidecar written to: $OUTPUT_DIR"
