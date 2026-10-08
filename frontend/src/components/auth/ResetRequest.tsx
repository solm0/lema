import { useEffect, useState } from "react"
import { requestReset } from "../../api"
import Button, { LinkButton } from "../../components/util/Button"
import SystemMessage from "./SystemMessage"
import { useI18n } from "../../i18n"
import { resolveAuthMessage } from "./errorMessages"
import { isDefinitelyOffline, isNetworkError } from "../../network"

export default function ResetRequest(){

  const [email,setEmail]=useState("")
  const [msg,setMsg]=useState("")
  const [submitting, setSubmitting] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [rateLimited, setRateLimited] = useState(false)
  const { t } = useI18n();

  useEffect(() => {
    if (!cooldownUntil) return

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
      setCooldownSeconds(remaining)
      if (!remaining) {
        setCooldownUntil(0)
        setRateLimited(false)
      }
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 250)
    return () => window.clearInterval(timer)
  }, [cooldownUntil])

  async function submit(){
    if (submitting || cooldownSeconds > 0) return

    if (email.trim()) {
      setSubmitting(true)
      try {
        const res=await requestReset(email);

        if (res.httpStatus === 429) {
          const seconds = Math.max(1, res.retryAfterSeconds ?? 10)
          setRateLimited(true)
          setCooldownUntil(Date.now() + seconds * 1000)
          setCooldownSeconds(seconds)
        } else if (res.detail) {
          setMsg(t(resolveAuthMessage(res.detail)))
        } else {
          setMsg(t("If an account exists for this email, a reset link has been sent. It may take a few minutes."))
          setRateLimited(false)
          setCooldownUntil(Date.now() + 60_000)
          setCooldownSeconds(60)
        }
      } catch (error) {
        if (!isDefinitelyOffline() && isNetworkError(error)) {
          setCooldownUntil(Date.now() + 10_000)
          setCooldownSeconds(10)
        }
        setMsg(
          isDefinitelyOffline()
            ? t("You're offline. Check your connection and try again.")
            : isNetworkError(error)
              ? t("The request could not be completed. Please wait a moment and try again.")
            : t("error"),
        )
      } finally {
        setSubmitting(false)
      }
    } else {
      setMsg(t("enter your email."))
    }
  }

  const displayMessage = rateLimited && cooldownSeconds > 0
    ? t("Too many requests. Try again in {seconds} seconds.", { seconds: cooldownSeconds })
    : msg

  const buttonText = submitting
    ? t("Sending...")
    : cooldownSeconds > 0
      ? t("Send again in {seconds}s", { seconds: cooldownSeconds })
      : t("Request reset")

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
          <SystemMessage msg={displayMessage} />
          <Button text={buttonText} onClick={submit} disabled={submitting || cooldownSeconds > 0} fit />
        </div>
      </div>

      <div className="flex flex-col gap-2 text-neutral-900">
        <LinkButton text={t("Back to login")} link="/login" />
      </div>
    </>
  )
}
