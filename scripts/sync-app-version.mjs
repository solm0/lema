import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const frontendPackagePath = path.join(rootDir, "frontend", "package.json");
const electronPackagePath = path.join(rootDir, "electron", "package.json");
const androidGradlePath = path.join(
  rootDir,
  "frontend",
  "android",
  "app",
  "build.gradle",
);
const latestVersionDesktopPath = path.join(
  rootDir,
  "central",
  "static",
  "latest-version-desktop.json",
);
const latestVersionAndroidPath = path.join(
  rootDir,
  "central",
  "static",
  "latest-version-android.json",
);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function syncLatestVersionFile(filePath, version, defaults) {
  const current = readJson(filePath);
  writeJson(filePath, {
    ...defaults,
    ...current,
    version,
  });
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

  if (!match) {
    throw new Error(
      `Unsupported version format "${version}". Expected x.y.z`,
    );
  }

  return match.slice(1).map((part) => Number(part));
}

function toAndroidVersionCode(version) {
  const [major, minor, patch] = parseSemver(version);
  return major * 10000 + minor * 100 + patch;
}

const frontendPackage = readJson(frontendPackagePath);
const androidVersion = frontendPackage.version;

if (typeof androidVersion !== "string" || androidVersion.length === 0) {
  throw new Error("frontend/package.json is missing a valid version");
}

const electronPackage = readJson(electronPackagePath);
const desktopVersion = electronPackage.version;

if (typeof desktopVersion !== "string" || desktopVersion.length === 0) {
  throw new Error("electron/package.json is missing a valid version");
}

syncLatestVersionFile(latestVersionDesktopPath, desktopVersion, {
  platform: "desktop",
  download_url: "https://lema.solmi.wiki/#download-desktop",
  notes: [],
});
syncLatestVersionFile(latestVersionAndroidPath, androidVersion, {
  platform: "android",
  download_url: "https://lema.solmi.wiki/#download-android",
  notes: [],
});

const androidGradle = readFileSync(androidGradlePath, "utf-8")
  .replace(/versionCode\s+\d+/, `versionCode ${toAndroidVersionCode(androidVersion)}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${androidVersion}"`);

writeFileSync(androidGradlePath, androidGradle, "utf-8");

process.stdout.write(
  `Synced desktop version ${desktopVersion} and android version ${androidVersion}\n`,
);
