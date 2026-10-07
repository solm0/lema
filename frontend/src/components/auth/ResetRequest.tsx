import { useState } from "react"
import { requestReset } from "../../api"
import Button, { LinkButton } from "../../components/util/Button"
import SystemMessage from "./SystemMessage"
import { useI18n } from "../../i18n"
import { resolveAuthMessage } from "./errorMessages"
import { isNetworkError } from "../../network"

export default function ResetRequest(){

  const [email,setEmail]=useState("")
  const [msg,setMsg]=useState("")
  const [submitting, setSubmitting] = useState(false)
  const { t } = useI18n();

  async function submit(){
    if (submitting) return

    if (email.trim()) {
      setSubmitting(true)
      try {
        const res=await requestReset(email);

        if (res.httpStatus === 429) {
          setMsg(t("Too many requests. Please wait and try again."))
        } else if (res.detail) {
          setMsg(t(resolveAuthMessage(res.detail)))
        } else {
          setMsg(t("If an account exists for this email, a reset link has been sent. It may take a few minutes."))
        }
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
      setMsg(t("enter your email."))
    }
  }

  return(
    <>
      <div className="flex flex-col items-start gap-4 w-full text-lg">
        <input
          type="text"
          placeholder={t("email")}
          value={email}
          onChange={e=>setEmail(e.target.value)}
          className="w-full border-2 border-neutral-900 text-neutral-900 rounded-sm px-3 py-2 focus:outline-none opacity-30 focus:opacity-80 transition-opacity"
          autoFocus
          autoCapitalize="none"
        />

        <div className="flex flex-col gap-2 w-full">
          <SystemMessage msg={msg} />
          <Button text={submitting ? t("Sending...") : t("Request reset")} onClick={submit} disabled={submitting} fit />
        </div>
      </div>

      <div className="flex flex-col gap-2 text-neutral-900">
        <LinkButton text={t("Back to login")} link="/login" />
      </div>
    </>
  )
}
