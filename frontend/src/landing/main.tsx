/* eslint-disable react-refresh/only-export-components */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import type { CSSProperties } from "react";
import "../index.css";
import LandingApp from "./LandingApp";
import AccountDeletionPage from "./AccountDeletionPage";
import BackgroundPage from "./BackgroundPage";
import LandingFooter from "./LandingFooter";
import LandingHeader from "./LandingHeader";
import { applyTheme } from "../components/useTheme";
import { I18nProvider, resolveInitialLocale } from "../i18n";

applyTheme("light");
const initialLocale = resolveInitialLocale();
const DEV_LANDING_HOME_PATH = "/landing/index.html";
const DEV_CHROME_PRIVACY_PATH = "/landing/chrome-extension-privacy/index.html";
const DEV_ANDROID_PRIVACY_PATH = "/landing/android-app-privacy/index.html";
const DEV_ANDROID_ACCOUNT_DELETION_PATH = "/landing/android-app-account-deletion/index.html";
const DEV_BACKGROUND_PATH = "/landing/background/index.html";
const PROD_HOME_PATH = "/";
const PROD_CHROME_PRIVACY_PATH = "/chrome-extension-privacy";
const PROD_ANDROID_PRIVACY_PATH = "/android-app-privacy";
const PROD_ANDROID_ACCOUNT_DELETION_PATH = "/android-app-account-deletion";
const PROD_BACKGROUND_PATH = "/background";

function isDevLandingPath(pathname: string) {
  return pathname.startsWith("/landing/");
}

function buildPrivacyHref(pathname: string, devPath: string, prodPath: string) {
  return isDevLandingPath(pathname) ? devPath : prodPath;
}

const currentPathname = window.location.pathname;
const chromePrivacyHref = buildPrivacyHref(
  currentPathname,
  DEV_CHROME_PRIVACY_PATH,
  PROD_CHROME_PRIVACY_PATH,
);
const androidPrivacyHref = buildPrivacyHref(
  currentPathname,
  DEV_ANDROID_PRIVACY_PATH,
  PROD_ANDROID_PRIVACY_PATH,
);
const androidAccountDeletionHref = buildPrivacyHref(
  currentPathname,
  DEV_ANDROID_ACCOUNT_DELETION_PATH,
  PROD_ANDROID_ACCOUNT_DELETION_PATH,
);
const backgroundHref = buildPrivacyHref(
  currentPathname,
  DEV_BACKGROUND_PATH,
  PROD_BACKGROUND_PATH,
);
const homeHref = buildPrivacyHref(
  currentPathname,
  DEV_LANDING_HOME_PATH,
  PROD_HOME_PATH,
);

type PrivacyLocale = "en" | "ko";
type PrivacyCopy = Record<
  PrivacyLocale,
  {
    title: string;
    updatedAt: string;
    intro: string;
    sections: Array<{ heading: string; paragraphs: string[] }>;
  }
>;

const chromePrivacyCopy: PrivacyCopy = {
  en: {
    title: "Lema Chrome Extension Privacy Policy",
    updatedAt: "Last updated: October 1, 2026",
    intro:
      "The Lema Chrome Extension (the \"Extension\") works with the Lema desktop app to analyze and save text selected from web pages. This Privacy Policy explains what information the Extension processes, why it is used, and with whom it may be shared.",
    sections: [
      {
        heading: "1. Information We Process",
        paragraphs: [
          "The Extension may process text that the user directly selects on a web page, the title and language chosen by the user, and the current page URL at the time the user chooses to save it.",
          "The Extension may read whether the Lema desktop app is running and signed in, and the list of language packs installed in the app, so the user can save to the correct local library and choose an available language. The Extension does not receive or store account IDs, passwords, or authentication tokens.",
        ],
      },
      {
        heading: "2. When Information Is Processed",
        paragraphs: [
          "Selected text and the current page URL are processed only when the user explicitly runs the save action.",
          "The Extension checks whether the Lema desktop app is running and signed in when the user starts a save. Installed language-pack information is read when the Extension opens or refreshes its available languages.",
        ],
      },
      {
        heading: "3. Why Information Is Used",
        paragraphs: [
          "To provide text analysis for content selected by the user.",
          "To save analyzed pages and results in the Lema desktop app's local library.",
          "To open saved pages again in the Lema desktop app.",
          "To maintain service security, reliability, and error handling.",
        ],
      },
      {
        heading: "4. Sharing and Disclosure",
        paragraphs: [
          "The Extension sends selected text, its title and language, and the current page URL only to Lema's local desktop service for text analysis and storage in the user's local library. The Extension does not send account credentials, selected text, page URLs, or saved-page data to Lema's remote servers.",
          "We do not sell user information and do not use it for personalized advertising or third-party advertising purposes.",
        ],
      },
      {
        heading: "5. Local Communication",
        paragraphs: [
          "The Extension may communicate with a local service running on the user's device in order to work with the Lema desktop app. This communication is limited to the core functionality of the Extension.",
        ],
      },
      {
        heading: "6. Retention and Deletion",
        paragraphs: [
          "The Extension does not retain selected text, page URLs, account credentials, or authentication tokens in browser extension storage.",
          "Saved pages remain in the desktop app's local library until the user deletes them or clears the app data.",
        ],
      },
      {
        heading: "7. User Choice",
        paragraphs: [
          "The Extension does not provide account creation or sign-in. Saving a page requires the user to be signed in to the Lema desktop app.",
          "The save function runs only when the user explicitly triggers it.",
          "Users may remove the Extension at any time.",
        ],
      },
      {
        heading: "8. Contact",
        paragraphs: ["solmii.jeong@gmail.com"],
      },
    ],
  },
  ko: {
    title: "Lema Chrome 확장 프로그램 개인정보처리방침",
    updatedAt: "최종 업데이트: 2026년 10월 1일",
    intro:
      "Lema Chrome 확장 프로그램(이하 \"확장 프로그램\")은 Lema 데스크톱 앱과 연동하여 웹페이지의 선택 텍스트를 분석하고 로컬에 저장하는 기능을 제공합니다. 본 개인정보처리방침은 확장 프로그램이 어떤 정보를 처리하는지, 어떤 목적으로 사용하는지, 누구와 공유하는지를 설명합니다.",
    sections: [
      {
        heading: "1. 처리하는 정보",
        paragraphs: [
          "확장 프로그램은 사용자가 직접 선택한 웹페이지 텍스트, 사용자가 선택한 제목과 언어, 저장을 실행한 시점의 현재 페이지 URL을 처리할 수 있습니다.",
          "확장 프로그램은 올바른 로컬 라이브러리에 저장하고 사용 가능한 언어를 표시하기 위해 Lema 데스크톱 앱의 실행 및 로그인 상태와 설치된 언어팩 목록을 읽을 수 있습니다. 확장 프로그램은 계정 ID, 비밀번호, 인증 토큰을 받거나 저장하지 않습니다.",
        ],
      },
      {
        heading: "2. 정보를 처리하는 시점",
        paragraphs: [
          "사용자가 저장 기능을 실행할 때만 선택한 텍스트와 현재 페이지 URL을 처리합니다.",
          "사용자가 저장을 시작할 때 Lema 데스크톱 앱의 실행 및 로그인 상태를 확인합니다. 확장 프로그램을 열거나 사용 가능한 언어를 새로고침할 때 설치된 언어팩 정보를 읽습니다.",
        ],
      },
      {
        heading: "3. 정보 이용 목적",
        paragraphs: [
          "선택한 텍스트의 분석 기능 제공",
          "분석 결과와 페이지를 Lema 데스크톱 앱의 로컬 라이브러리에 저장",
          "저장된 페이지를 Lema 데스크톱 앱에서 다시 열 수 있도록 지원",
          "서비스 보안 유지, 오류 대응, 기능 안정성 확보",
        ],
      },
      {
        heading: "4. 정보 공유 및 제공",
        paragraphs: [
          "확장 프로그램은 텍스트 분석과 사용자의 로컬 라이브러리 저장을 위해 선택한 텍스트, 제목과 언어, 현재 페이지 URL을 Lema 로컬 데스크톱 서비스에만 전송합니다. 확장 프로그램은 계정 인증 정보, 선택한 텍스트, 페이지 URL, 저장한 페이지 데이터를 Lema 원격 서버로 전송하지 않습니다.",
          "당사는 사용자의 정보를 판매하지 않으며, 개인 맞춤 광고 또는 제3자 광고 목적에 사용하지 않습니다.",
        ],
      },
      {
        heading: "5. 로컬 통신에 관한 안내",
        paragraphs: [
          "확장 프로그램은 Lema 데스크톱 앱과 연동하기 위해 사용자의 기기에서 실행 중인 로컬 서비스와 통신할 수 있습니다. 이 통신은 확장 프로그램의 핵심 기능 제공을 위한 목적에 한해 이루어집니다.",
        ],
      },
      {
        heading: "6. 보관 및 삭제",
        paragraphs: [
          "확장 프로그램은 선택한 텍스트, 페이지 URL, 계정 인증 정보, 인증 토큰을 브라우저의 확장 프로그램 저장소에 보관하지 않습니다.",
          "저장한 페이지는 사용자가 삭제하거나 앱 데이터를 지울 때까지 데스크톱 로컬 라이브러리에 유지됩니다.",
        ],
      },
      {
        heading: "7. 이용자의 선택",
        paragraphs: [
          "확장 프로그램은 계정 생성이나 로그인 기능을 제공하지 않습니다. 페이지를 저장하려면 Lema 데스크톱 앱에 로그인되어 있어야 합니다.",
          "저장 기능은 사용자의 명시적인 실행이 있을 때만 동작합니다.",
          "사용자는 언제든지 확장 프로그램을 제거할 수 있습니다.",
        ],
      },
      {
        heading: "8. 문의처",
        paragraphs: ["solmii.jeong@gmail.com"],
      },
    ],
  },
};

const androidPrivacyCopy: PrivacyCopy = {
  en: {
    title: "Lema Android App Privacy Policy",
    updatedAt: "Last updated: August 31, 2026",
    intro:
      "The Lema Android app (the \"App\") helps users read and analyze foreign-language text and find lyrics for music playing on their device. This Privacy Policy explains what information the App processes, why it is used, and when it is shared.",
    sections: [
      {
        heading: "1. Information We Process",
        paragraphs: [
          "When you create an account or sign in, the App processes information such as your name, email address, password, and authentication token.",
          "The App processes text, pages, language selections, and annotations that you choose to create or save.",
          "If you enable Android notification access, the App uses active media-session information such as the song title, artist, album, playback state, and the name of the player app. Although Android grants broad notification access, Lema does not use message or conversation content for this feature.",
          "The App stores preferences, downloaded language data, pages, notebooks, and annotations on your device.",
        ],
      },
      {
        heading: "2. How Information Is Used",
        paragraphs: [
          "We use account information to sign you in and provide account features.",
          "We use text and saved content to analyze language, save pages, and provide annotations.",
          "We use media-session information to identify the current song, find lyrics, and show optional now-playing alerts.",
          "We may use technical information needed to keep the service secure, reliable, and operational.",
        ],
      },
      {
        heading: "3. Notification Access and Your Choice",
        paragraphs: [
          "Notification access is optional. The App asks for your consent before opening Android settings, and you can continue using other features without granting it.",
          "You can revoke notification access at any time in Android settings. You can also turn off now-playing alerts in the App settings.",
        ],
      },
      {
        heading: "4. Sharing and Third-Party Services",
        paragraphs: [
          "To find lyrics, the App sends the current song title and artist name to the LRCLIB service at lrclib.net. It does not send your Lema account identifier with this request.",
          "Account data, interested-lemma changes, and text submitted for mobile language analysis may be sent to Lema servers. Pages, notebooks, and annotations are stored in the device's local library and are not synchronized to Lema servers.",
          "We do not sell personal information or use it for personalized or third-party advertising.",
        ],
      },
      {
        heading: "5. Storage and Retention",
        paragraphs: [
          "Device preferences, authentication information, cached lyrics, downloaded language data, pages, notebooks, and annotations may be stored locally on your device.",
          "Account information and cloud interests stored on Lema servers are retained while needed to provide the service or until you delete them or delete your account, subject to legal and security requirements.",
        ],
      },
      {
        heading: "6. Deletion and Control",
        paragraphs: [
          "You can delete saved content in the App and delete your account from the profile section. Deleting your account does not delete the local library. You can remove local App data by clearing the App's storage or uninstalling it.",
          "You can revoke Android permissions and special access from the device settings at any time.",
        ],
      },
      {
        heading: "7. Security",
        paragraphs: [
          "We use reasonable measures to protect information. No method of storage or transmission can guarantee complete security.",
        ],
      },
      {
        heading: "8. Contact",
        paragraphs: ["solmii.jeong@gmail.com"],
      },
    ],
  },
  ko: {
    title: "Lema Android 앱 개인정보처리방침",
    updatedAt: "최종 업데이트: 2026년 8월 31일",
    intro:
      "Lema Android 앱(이하 \"앱\")은 외국어 텍스트를 읽고 분석하며, 기기에서 재생 중인 음악의 가사를 찾을 수 있도록 돕습니다. 본 개인정보처리방침은 앱이 어떤 정보를 처리하고, 왜 사용하며, 언제 공유하는지 설명합니다.",
    sections: [
      {
        heading: "1. 처리하는 정보",
        paragraphs: [
          "회원가입하거나 로그인할 때 이름, 이메일 주소, 비밀번호, 인증 토큰 등의 정보를 처리합니다.",
          "사용자가 만들거나 저장한 텍스트, 페이지, 언어 선택 및 주석을 처리합니다.",
          "Android 알림 접근을 허용하면 곡 제목, 아티스트, 앨범, 재생 상태 및 재생 앱 이름과 같은 활성 미디어 세션 정보를 사용합니다. Android는 넓은 알림 접근 권한을 부여하지만, Lema는 이 기능을 위해 메시지나 대화 내용을 사용하지 않습니다.",
          "앱 설정, 다운로드한 언어 데이터, 페이지, 노트북, 주석을 기기에 저장합니다.",
        ],
      },
      {
        heading: "2. 정보 이용 목적",
        paragraphs: [
          "계정 정보는 로그인과 계정 기능 제공에 사용합니다.",
          "텍스트와 저장 콘텐츠는 언어 분석, 페이지 저장 및 주석 기능 제공에 사용합니다.",
          "미디어 세션 정보는 현재 곡 확인, 가사 검색 및 선택적인 지금 재생 알림에 사용합니다.",
          "서비스의 보안, 안정성 및 운영에 필요한 기술 정보를 사용할 수 있습니다.",
        ],
      },
      {
        heading: "3. 알림 접근과 사용자의 선택",
        paragraphs: [
          "알림 접근은 선택 사항입니다. 앱은 Android 설정을 열기 전에 동의를 요청하며, 허용하지 않아도 다른 기능을 계속 사용할 수 있습니다.",
          "Android 설정에서 언제든지 알림 접근을 해제할 수 있으며, 앱 설정에서 지금 재생 알림도 끌 수 있습니다.",
        ],
      },
      {
        heading: "4. 정보 공유 및 외부 서비스",
        paragraphs: [
          "가사를 찾기 위해 현재 곡 제목과 아티스트 이름을 LRCLIB 서비스(lrclib.net)에 전송합니다. 이 요청에는 Lema 계정 식별자를 함께 보내지 않습니다.",
          "계정 정보, 표제어 즐겨찾기, 모바일 언어 분석을 위한 텍스트는 Lema 서버로 전송될 수 있습니다. 페이지, 노트북, 주석은 기기의 로컬 라이브러리에 저장되며 Lema 서버와 동기화되지 않습니다.",
          "개인정보를 판매하거나 개인 맞춤 광고 또는 제3자 광고에 사용하지 않습니다.",
        ],
      },
      {
        heading: "5. 저장 및 보관",
        paragraphs: [
          "앱 설정, 인증 정보, 캐시된 가사, 다운로드한 언어 데이터, 페이지, 노트북, 주석은 사용자의 기기에 저장될 수 있습니다.",
          "Lema 서버의 계정 정보와 클라우드 즐겨찾기는 서비스 제공에 필요한 동안 또는 사용자가 해당 데이터나 계정을 삭제할 때까지 보관될 수 있습니다. 법률 및 보안상 필요한 경우는 예외입니다.",
        ],
      },
      {
        heading: "6. 삭제 및 통제",
        paragraphs: [
          "앱에서 저장 콘텐츠를 삭제할 수 있으며 프로필에서 계정을 삭제할 수 있습니다. 계정을 삭제해도 로컬 라이브러리는 유지됩니다. 앱 저장공간을 지우거나 앱을 제거하면 기기에 저장된 로컬 데이터를 삭제할 수 있습니다.",
          "Android 기기 설정에서 언제든지 권한과 특별 접근을 해제할 수 있습니다.",
        ],
      },
      {
        heading: "7. 보안",
        paragraphs: [
          "정보를 보호하기 위해 합리적인 조치를 사용하지만, 어떤 저장 및 전송 방식도 완전한 보안을 보장할 수는 없습니다.",
        ],
      },
      {
        heading: "8. 문의처",
        paragraphs: ["solmii.jeong@gmail.com"],
      },
    ],
  },
};

function PrivacyPage({
  copies,
  accountDeletionHref,
}: {
  copies: PrivacyCopy;
  accountDeletionHref?: string;
}) {
  const [locale, setLocale] = useState<PrivacyLocale>("en");
  const copy = copies[locale];

  return (
    <main style={pageStyle}>
      <div style={contentStyle}>
        <h1 style={titleStyle}>{copy.title}</h1>
        <div style={localeToggleRowStyle}>
          <button
            type="button"
            onClick={() => setLocale("en")}
            style={locale === "en" ? activeLocaleButtonStyle : localeButtonStyle}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLocale("ko")}
            style={locale === "ko" ? activeLocaleButtonStyle : localeButtonStyle}
          >
            KO
          </button>
        </div>
        <p style={paragraphStyle}>{copy.updatedAt}</p>
        <p style={paragraphStyle}>{copy.intro}</p>

        {copy.sections.map((section) => (
          <section key={section.heading}>
            <h2 style={sectionTitleStyle}>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} style={paragraphStyle}>
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        {accountDeletionHref ? (
          <a href={accountDeletionHref} style={accountDeletionLinkStyle}>
            Delete Lema account / Lema 계정 삭제
          </a>
        ) : null}
      </div>
    </main>
  );
}

const pageStyle: CSSProperties = {
  padding: "48px 20px 80px",
};

const contentStyle: CSSProperties = {
  maxWidth: "760px",
  margin: "0 auto",
  wordBreak: "keep-all",
  overflowWrap: "break-word",
};

const titleStyle: CSSProperties = {
  fontSize: "2rem",
  fontWeight: 700,
  margin: "0 0 24px",
};

const localeToggleRowStyle: CSSProperties = {
  margin: "0 0 18px",
};

const localeButtonStyle: CSSProperties = {
  fontSize: "0.95rem",
  fontWeight: 400,
  margin: "0 12px 0 0",
};

const activeLocaleButtonStyle: CSSProperties = {
  ...localeButtonStyle,
  fontWeight: 700,
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "1.25rem",
  fontWeight: 700,
  margin: "40px 0 14px",
};

const paragraphStyle: CSSProperties = {
  fontSize: "1rem",
  fontWeight: 400,
  margin: "0 0 14px",
};

const accountDeletionLinkStyle: CSSProperties = {
  display: "inline-block",
  marginTop: "28px",
  color: "#b91c1c",
  fontSize: "1rem",
  fontWeight: 700,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider locale={initialLocale}>
      <BrowserRouter>
        <LandingHeader homeHref={homeHref} />
        <div className="h-16 md:h-32 lg:hidden" aria-hidden="true" />
        <Routes>
          <Route path={PROD_HOME_PATH} element={<LandingApp />} />
          <Route path={DEV_LANDING_HOME_PATH} element={<LandingApp />} />
          <Route path={PROD_BACKGROUND_PATH} element={<BackgroundPage />} />
          <Route path={DEV_BACKGROUND_PATH} element={<BackgroundPage />} />
          <Route path={PROD_CHROME_PRIVACY_PATH} element={<PrivacyPage copies={chromePrivacyCopy} />} />
          <Route path={DEV_CHROME_PRIVACY_PATH} element={<PrivacyPage copies={chromePrivacyCopy} />} />
          <Route path={PROD_ANDROID_PRIVACY_PATH} element={<PrivacyPage copies={androidPrivacyCopy} accountDeletionHref={androidAccountDeletionHref} />} />
          <Route path={DEV_ANDROID_PRIVACY_PATH} element={<PrivacyPage copies={androidPrivacyCopy} accountDeletionHref={androidAccountDeletionHref} />} />
          <Route path={PROD_ANDROID_ACCOUNT_DELETION_PATH} element={<AccountDeletionPage />} />
          <Route path={DEV_ANDROID_ACCOUNT_DELETION_PATH} element={<AccountDeletionPage />} />
          <Route path="*" element={<LandingApp />} />
        </Routes>
        <LandingFooter
          backgroundHref={backgroundHref}
          chromePrivacyHref={chromePrivacyHref}
          androidPrivacyHref={androidPrivacyHref}
          accountDeletionHref={androidAccountDeletionHref}
        />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);
