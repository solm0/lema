import { useState } from "react"
import { resetPassword } from "../../api"
import SystemMessage from "./SystemMessage"
import Button, { LinkButton } from "../../components/util/Button"
import { useI18n } from "../../i18n"
import { resolveAuthMessage } from "./errorMessages"
import { isNetworkError } from "../../network"

export default function ResetPassword(){

  const url=new URL(window.location.href)
  const token=url.searchParams.get("token")||""

  const [pw,setPw]=useState("")
  const [msg,setMsg]=useState("")
  const [submitting, setSubmitting] = useState(false)
  const { t } = useI18n();

  async function submit(){
    if (submitting) return

    if (pw.trim()) {
      setSubmitting(true)
      try {
        const res=await resetPassword(token,pw);

        if (res.detail) {
          setMsg(t(resolveAuthMessage(res.detail)))
        } else setMsg("your password was reset.")
      } catch (error) {
        setMsg(
          isNetworkError(error)
            ? t("You're offline. Check your connection and try again.")
            : t("error"),
        )
      } finally {
        setSubmitting(false)
      }
    } else {
      setMsg('enter your new password.')
    }
  }

  return(
    <>
      <div className="flex flex-col items-start gap-4 w-full text-lg">
        <input
          type="password"
          placeholder={t("password")}
          value={pw}
          onChange={e=>setPw(e.target.value)}
          className="w-full border-2 border-neutral-900 text-neutral-900 rounded-sm px-3 py-2 focus:outline-none opacity-30 focus:opacity-80 transition-opacity"
          autoCapitalize="none"
        />

        <div className="flex flex-col gap-2 w-full">
          <SystemMessage msg={msg} />
          <Button text={submitting ? "..." : t("Change password")} onClick={submit} disabled={submitting} fit />
        </div>

      </div>

      {msg === 'your password was reset.' && <LinkButton link="/login" text={t("Login")} />}
    </>
  )
}
