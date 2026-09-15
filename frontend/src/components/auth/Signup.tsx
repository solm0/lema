import { useState } from "react"
import { signup } from "../../api"
import Button, { LinkButton } from "../../components/util/Button"
import SystemMessage from "./SystemMessage"
import { useI18n } from "../../i18n"
import { resolveAuthMessage } from "./errorMessages"
import { isNetworkError } from "../../network"

export default function Signup(){
  const [name, setName] = useState("")
  const [email,setEmail]=useState("")
  const [password,setPassword]=useState("")
  const [msg,setMsg]=useState("")
  const [submitting, setSubmitting] = useState(false)
  const { t } = useI18n();

  async function submit(){
    if (submitting) return

    if (name.trim() && email.trim() && password.trim()) {
      setSubmitting(true)
      try {
        const res=await signup(email,password,name);

        if (res.detail) {
          setMsg(t(resolveAuthMessage(res.detail)))
        } else setMsg("email sent.")
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
      setMsg("enter your name, email, and password.")
    }
  }

  return(
    <>
      <div className="flex flex-col items-start gap-4 w-full text-lg">
        <input
          type="text"
          placeholder={t("name")}
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full border-2 border-neutral-900 text-neutral-900 rounded-sm px-3 py-2 focus:outline-none opacity-30 focus:opacity-80 transition-opacity"
          autoFocus
          autoCapitalize="none"
        />

        <input
          type="text"
          placeholder={t("email")}
          value={email}
          onChange={e=>setEmail(e.target.value)}
          className="w-full border-2 border-neutral-900 text-neutral-900 rounded-sm px-3 py-2 focus:outline-none opacity-30 focus:opacity-80 transition-opacity"
          autoCapitalize="none"
        />

        <input
          type="password"
          placeholder={t("password")}
          value={password}
          onChange={e=>setPassword(e.target.value)}
          className="w-full border-2 border-neutral-900 text-neutral-900 rounded-sm px-3 py-2 focus:outline-none opacity-30 focus:opacity-50 transition-opacity"
          autoCapitalize="none"
        />

        <div className="flex flex-col gap-2 w-full">
          <SystemMessage msg={msg} />
          <Button text={submitting ? "..." : t("Sign up")} onClick={submit} disabled={submitting} fit />
        </div>
      </div>


      <div className="flex flex-col gap-2 text-neutral-900">
        <LinkButton text={t("Already have an account?")} link="/login" />
      </div>
    </>
  )
}
