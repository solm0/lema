// Electron 앱 내부에서는 개발용 로컬 백엔드를 바라본다.
// 개발 중에는 .env로 제어
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8010";

export const ANDROID_PRIVACY_POLICY_URL =
  "https://lema.solmi.wiki/android-app-privacy";
