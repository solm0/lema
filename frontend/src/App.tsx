import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import AuthLayout from "./components/auth/AuthLayout";
import Login from "./components/auth/Login";
import Signup from "./components/auth/Signup";
import ResetPassword from "./components/auth/ResetPassword";
import ResetRequest from "./components/auth/ResetRequest";
import HomeLayout from "./components/HomeLayout";
import PageView from "./components/pageview/PageView";
import New from "./components/new/New";
import Lemmas from "./components/lemmas/lemmas";
import Annotations from "./components/annotations/Annotations";
import RootLayout from "./components/RootLayout";
import PageLayout from "./components/pages/PageLayout";
import { NewPage } from "./components/pages/NewPage";
import Setting from "./components/setting/Setting";
import LyricPage from "./components/lyric/LyricPage";
import { GRADSHOW_MODE } from "./gradshow/mode";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<RootLayout />}>
          <Route element={<HomeLayout />} >
            <Route element={<PageLayout />}>
              <Route path="/" element={<NewPage />} />
              <Route path="/page/:id" element={<PageView />} />
            </Route>
            <Route path="/setting" element={<Setting />} />
            <Route path="/annotations" element={<Annotations />} />
            <Route path="/lemmas" element={<Lemmas />} />
            <Route path="/new" element={GRADSHOW_MODE ? <Navigate to="/" replace /> : <New />} />
            <Route path="/lyric" element={GRADSHOW_MODE ? <Navigate to="/" replace /> : <LyricPage />} />
          </Route>

          {GRADSHOW_MODE ? (
            <Route path="*" element={<Navigate to="/" replace />} />
          ) : (
            <Route element={<AuthLayout />} >
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/reset-request" element={<ResetRequest />} />
            </Route>
          )}
        </Route>
      </Routes>
    </HashRouter>
  )
}
