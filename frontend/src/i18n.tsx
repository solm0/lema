import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

export type AppLocale = "en" | "ko";

type TranslationParams = Record<string, string | number>;

type I18nContextValue = {
  locale: AppLocale;
  t: (key: string, params?: TranslationParams) => string;
};

const STORAGE_KEY = "lema_settings";
const LEGACY_STORAGE_KEY = "nautilus_settings";

const translations: Record<AppLocale, Record<string, string>> = {
  en: {
    "lateral_fricative": "lateral fricative",
    "lateral_approximant": "lateral approximant",
    "labial-velar": "labial–velar",
    "labial-palatal": "labial–palatal",
  },
  ko: {
    "Agree and open settings": "동의하고 설정 열기",
    "Accept": "수락",
    "Activate": "활성화",
    "Activated": "활성화됨",
    "Activate a language to continue.": "계속하려면 언어를 활성화하세요.",
    "Activate {language}?": "{language}를 활성화할까요?",
    "Activate {language} to continue.": "{language}를 활성화해 계속하세요.",
    "Activate only the languages you want to use on this device.": "이 기기에서 사용할 언어만 활성화하세요.",
    "Activating...": "활성화 중...",
    "Add your thoughts...": "생각을 적어보세요...",
    "Already have an account?": "이미 계정이 있나요?",
    "Allow notifications?": "알림을 허용할까요?",
    "Android app privacy policy": "Android 앱 개인정보처리방침",
    "Local library": "로컬 라이브러리",
    "Pages, notebooks, and annotations are stored only on this device. Export a backup to move or restore them on another device.": "페이지, 노트북, 주석은 이 기기에만 저장됩니다. 다른 기기로 옮기거나 복구하려면 백업을 내보내세요.",
    "Export library": "라이브러리 내보내기",
    "Exporting...": "내보내는 중...",
    "Import and merge": "가져와서 병합",
    "Importing...": "가져오는 중...",
    "Import keeps existing data and merges the selected library. Conflicting copies are preserved separately.": "기존 데이터는 유지하고 선택한 라이브러리를 병합합니다. 충돌하는 복사본은 따로 보존됩니다.",
    "Library exported.": "라이브러리를 내보냈습니다.",
    "Could not export library.": "라이브러리를 내보내지 못했습니다.",
    "Could not import library.": "라이브러리를 가져오지 못했습니다.",
    "Import complete: {pages} pages, {notebooks} notebooks, {annotations} annotations, {conflicts} conflicts.": "병합 완료: 페이지 {pages}개, 노트북 {notebooks}개, 주석 {annotations}개, 충돌 복사본 {conflicts}개.",
    "Your account and cloud interests will be deleted. The local library on this device will remain.": "계정과 클라우드 관심 단어가 삭제됩니다. 이 기기의 로컬 라이브러리는 유지됩니다.",
    "To show now playing alerts on this device, allow notifications for Lema in Android settings.": "이 기기에서 지금 재생 알림을 보려면 Android 설정에서 Lema 알림을 허용하세요.",
    "Turn on notifications": "알림 켜기",
    "Lema can show now playing alerts while the app is in the background. Allow notifications in Android settings to use this feature.": "Lema는 앱이 백그라운드에 있을 때도 지금 재생 알림을 보여줄 수 있습니다. 이 기능을 사용하려면 Android 설정에서 알림을 허용하세요.",
    "Annotations": "주석",
    "App version": "앱 버전",
    "Back to login": "로그인으로 돌아가기",
    "Cancel": "취소",
    "Change password": "비밀번호 변경",
    "Checking current playback...": "현재 재생 상태를 확인하는 중...",
    "Clear search": "검색 지우기",
    "Chrome browser": "Chrome 브라우저",
    "Close": "닫기",
    "Close sidebar": "사이드바 닫기",
    "Close pages sidebar": "페이지 사이드바 닫기",
    "copy text": "텍스트 복사",
    "Connect to the internet to see installable languages.": "설치 가능한 언어를 보려면 네트워크에 연결하세요.",
    "Create": "생성",
    "Create an account": "계정 만들기",
    "Create new link": "새 링크 만들기",
    "Create new memo": "새 메모 만들기",
    "Create Notebook": "폴더 만들기",
    "Create notebook": "폴더 만들기",
    "Create Page": "페이지 만들기",
    "Create page": "페이지 만들기",
    "Created:": "생성일:",
    "Deactivate": "비활성화",
    "Delete": "삭제",
    "Delete account": "계정 삭제",
    "Delete account?": "계정을 삭제할까요?",
    "Delete failed": "삭제하지 못했습니다",
    "Delete this annotation?": "이 주석을 삭제할까요?",
    "[deleted]": "[삭제됨]",
    "Deleting...": "삭제 중...",
    "Deleting a notebook will also delete the pages inside it.": "폴더를 삭제하면 그 안의 페이지도 함께 삭제됩니다.",
    "Done": "완료",
    "Do not close this window until installation is complete.": "설치가 끝날 때까지 이 창을 닫지 마세요.",
    "Download now": "지금 다운로드",
    "Downloading language pack...": "언어팩 다운로드 중...",
    "email": "이메일",
    "email sent.": "이메일을 보냈습니다.",
    "End of the list": "목록의 끝입니다",
    "enter your email and password.": "이메일과 비밀번호를 입력하세요.",
    "enter your email.": "이메일을 입력하세요.",
    "enter your name, email, and password.": "이름, 이메일, 비밀번호를 입력하세요.",
    "enter your new password.": "새 비밀번호를 입력하세요.",
    "Enter a valid email address.": "올바른 이메일 주소를 입력하세요.",
    "error": "오류",
    "Extracting language pack...": "언어팩 압축 해제 중...",
    "Failed to activate language.": "언어를 활성화하지 못했습니다.",
    "Failed to deactivate language.": "언어를 비활성화하지 못했습니다.",
    "Failed to fetch install progress.": "설치 진행 상태를 가져오지 못했습니다.",
    "Failed to start installation.": "설치를 시작하지 못했습니다.",
    "Failed to uninstall pack.": "팩을 제거하지 못했습니다.",
    "Fetching page...": "페이지를 불러오는 중...",
    "Fetching lemmas...": "lemma를 불러오는 중...",
    "Filter by input method": "입력 경로로 필터링",
    "Filter by language": "언어로 필터링",
    "Filter by annotation type": "주석 유형으로 필터링",
    "Memo": "메모",
    "Link": "링크",
    "Emoji": "이모지",
    "Finalizing installation...": "설치 마무리 중...",
    "Find...": "검색...",
    "Forgot password?": "비밀번호를 잊으셨나요?",
    "Find lyrics for the song playing now?": "지금 재생 중인 곡의 가사를 찾을까요?",
    "Get lyrics": "가사 가져오기",
    "Go to page": "페이지로 이동",
    "Go to base": "기준 단어로 이동",
    "Go back": "뒤로가기",
    "hide": "숨기기",
    "Install ": "설치 ",
    "Install": "설치",
    "Installed": "설치됨",
    "Install {language} pack to continue.": "{language} 팩을 설치해 계속하세요.",
    "Install languages to continue.": "계속하려면 언어를 설치하세요.",
    "Installed successfully.": "설치 성공",
    "Installed, but failed to refresh the language list.": "설치는 완료됐지만 언어 목록을 새로고침하지 못했습니다.",
    "I know this word": "아는 단어예요",
    "Swipe right if you know the word.": "아는 단어라면 오른쪽으로 밀어 주세요.",
    "We'll prioritize examples containing words you know.": "아는 단어가 포함된 예문을 우선해서 보여드릴게요.",
    "Don't show this again": "더 이상 보지 않기",
    "You marked {count} {language} words as known!": "{language} 단어 {count}개를 안다고 표시했어요!",
    "You know “{lemma}”.": "‘{lemma}’를 알고 있어요.",
    "sentences containing “{lemma}” will be shown first.": "앞으로 ‘{lemma}’가 포함된 문장을 우선해서 보여드릴게요.",
    "Installation complete.": "설치가 완료되었습니다.",
    "Installation failed.": "설치에 실패했습니다.",
    "Installing {modelLabel}...": "{modelLabel} 설치 중...",
    "Installing {modelLabel}... {percent}%": "{modelLabel} 설치 중... {percent}%",
    "Invalid email or password.": "이메일 또는 비밀번호가 올바르지 않습니다.",
    "Invalid URL": "유효하지 않은 URL입니다",
    "Latest": "최신",
    "Lemma info": "lemma 정보",
    "Loading annotations...": "주석을 불러오는 중...",
    "Loading...": "불러오는 중...",
    "Looking for lyrics...": "가사를 찾는 중...",
    "Log out?": "로그아웃할까요?",
    "Login": "로그인",
    "Logout": "로그아웃",
    "Lyrics": "가사",
    "Lyrics were not found for the current track.": "현재 곡의 가사를 찾지 못했습니다.",
    "more": "더보기",
    "Move": "이동",
    "Move {count} pages": "{count}개 페이지 이동",
    "Move page \"{name}\"": "페이지 \"{name}\" 이동",
    "My Lemmas": "내 lemma",
    "name": "이름",
    "new emoji": "새 이모지",
    "new link": "새 링크",
    "new memo": "새 메모",
    "Next": "다음",
    "No active track was detected. On macOS, supported players are the desktop Spotify app and Music app. On Android, any player exposing a media session should work after notification access is granted.": "활성 트랙이 감지되지 않았습니다. macOS에서는 데스크톱 Spotify 앱과 Music 앱을 지원합니다. Android에서는 알림 접근 권한을 허용하면 미디어 세션을 노출하는 플레이어를 사용할 수 있습니다.",
    "No matches found.": "검색 결과가 없습니다.",
    "Notifications": "알림",
    "Notifications are blocked on this device. Open settings.": "이 기기에서는 알림이 차단되어 있습니다. 설정을 열어주세요.",
    "now playing alerts": "지금 재생 알림",
    "Now": "방금",
    "No results": "결과 없음",
    "No track": "재생 중인 트랙 없음",
    "Not now": "지금은 안 함",
    "notebook": "폴더",
    "Notebook": "폴더",
    "Notebook name": "폴더 이름",
    "Open notification settings": "알림 설정 열기",
    "Open sidebar": "사이드바 열기",
    "Open pages": "페이지 열기",
    "Open permission settings": "권한 설정 열기",
    "OK": "예",
    "page": "페이지",
    "Page name": "페이지 이름",
    "Pages": "페이지",
    "Paste text": "텍스트 붙여넣기",
    "Paste text here\n\nTip !!!\n\nAccuracy improves when punctuation and line breaks are used properly in sentences.": "여기에 텍스트를 붙여넣으세요\n\n팁\n\n문장 부호와 줄바꿈을 적절히 사용하면 정확도가 더 좋아집니다.",
    "password": "비밀번호",
    "plain": "일반",
    "Playback access is not enabled": "재생 접근 권한이 비활성화되어 있습니다",
    "Playback detection is unavailable": "재생 감지를 사용할 수 없습니다",
    "Platform:": "플랫폼:",
    "Preferences": "환경설정",
    "Prune": "가지치기",
    "Purge": "모두 정리",
    "Preparing installation...": "설치 준비 중...",
    "Preview will show here": "미리보기가 여기에 표시됩니다",
    "Profile": "프로필",
    "Request": "요청",
    "Review access": "접근 권한 확인",
    "Request reset": "재설정 요청",
    "Requests": "요청",
    "Retry": "다시 시도",
    "Try again": "다시 시도",
    "Revert changes": "변경 취소",
    "Relaunch": "재실행",
    "root": "루트",
    "Running Stanza analysis...": "Stanza 분석 실행 중...",
    "Analyzing selected text...": "선택한 텍스트 분석 중...",
    "Save": "저장",
    "Saved": "저장되었습니다",
    "Save changes": "변경 저장",
    "Save failed": "저장하지 못했습니다",
    "Save Page": "페이지 저장",
    "Saving...": "저장 중...",
    "Saving lyrics failed.": "가사를 저장하지 못했습니다.",
    "Search": "검색",
    "Select text to keep. Otherwise, all text will be used.": "유지할 텍스트를 선택하세요. 선택하지 않으면 전체 텍스트가 사용됩니다.",
    "Send request": "요청 보내기",
    "Sent": "보낸 요청",
    "Settings": "설정",
    "Sign up": "회원가입",
    "synced": "싱크됨",
    "System language": "시스템 언어",
    "Align center": "가운데 정렬",
    "Theme": "테마",
    "Switch to light mode": "라이트 모드로 전환",
    "Switch to dark mode": "다크 모드로 전환",
    "Light mode": "라이트 모드",
    "Dark mode": "다크 모드",
    "Light mode on": "라이트 모드 켜짐",
    "Dark mode on": "다크 모드 켜짐",
    "A new version({version}) is available.": "새 버전({version})을 사용할 수 있습니다.",
    "Android needs notification access to inspect active media sessions. macOS should work automatically with supported desktop players.": "Android에서는 활성 미디어 세션을 확인하려면 알림 접근 권한이 필요합니다. macOS는 지원되는 데스크톱 플레이어에서 자동으로 동작해야 합니다.",
    "Lema uses Android notification access only to read the current song and player. It sends the song title and artist to LRCLIB to find lyrics. You can keep using other features without allowing access.": "Lema는 현재 곡과 재생 앱을 확인할 때만 Android 알림 접근 권한을 사용합니다. 가사를 찾기 위해 곡 제목과 가수 이름을 LRCLIB에 보냅니다. 허용하지 않아도 다른 기능은 계속 사용할 수 있습니다.",
    "Could not load latest version.": "최신 버전을 불러오지 못했습니다.",
    "Could not delete account.": "계정을 삭제하지 못했습니다.",
    "Language packs": "언어팩",
    "Pin": "고정",
    "Please verify your email before logging in.": "로그인하기 전에 이메일 인증을 완료해주세요.",
    "Post": "게시",
    "Remove language pack": "언어팩 제거",
    "Rename": "이름 변경",
    "Add metadata": "메타데이터 추가",
    "Edit": "수정",
    "installing": "설치 중",
    "This email is already registered.": "이미 가입된 이메일입니다.",
    "This build did not expose the local now-playing bridge on this platform yet.": "이 빌드에서는 아직 이 플랫폼에 로컬 now-playing 브리지를 노출하지 않았습니다.",
    "This link is invalid or has expired.": "이 링크가 유효하지 않거나 만료되었습니다.",
    "To reduce storage, keep a single language version.": "저장 공간을 줄이려면 언어 버전을 하나만 유지하세요.",
    "Unknown": "알 수 없음",
    "Unknown artist": "알 수 없는 아티스트",
    "Unknown user": "알 수 없는 사용자",
    "Unnamed": "이름 없음",
    "Unpin": "고정 해제",
    "Uploads when you're back online.": "온라인 상태가 되면 업로드됩니다.",
    "User not found.": "사용자를 찾을 수 없습니다.",
    "We couldn't find this word.": "이 단어를 찾지 못했습니다.",
    "Yes": "예",
    "Your data will all disappear. Pages, annotations, and saved language data will be removed permanently.": "모든 데이터가 사라집니다. 페이지, 주석, 저장된 언어 데이터가 영구적으로 삭제됩니다.",
    "You're offline. Check your connection and try again.": "오프라인 상태입니다. 네트워크를 확인한 뒤 다시 시도하세요.",
    "You're offline.": "오프라인 상태입니다.",
    "your password was reset.": "비밀번호가 재설정되었습니다.",

    "German": "독일어",
    "English": "영어",
    "Japanese": "일본어",
    "Korean": "한국어",
    "Macedonian": "마케도니아어",
    "Russian": "러시아어",
    "Albanian": "알바니아어",
    "Serbian": "세르비아어"
  },
};

function replaceParams(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value == null ? `{${key}}` : String(value);
  });
}

function readStoredLocale(): AppLocale {
  if (typeof window === "undefined") {
    return "en";
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return "en";

    const parsed = JSON.parse(raw) as {
      system_language?: string;
    };

    return parsed.system_language === "ko" ? "ko" : "en";
  } catch {
    return "en";
  }
}

export function resolveInitialLocale(): AppLocale {
  return readStoredLocale();
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: AppLocale;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key, params) => {
        const template = translations[locale][key] ?? key;
        return replaceParams(template, params);
      },
    }),
    [locale],
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return context;
}
