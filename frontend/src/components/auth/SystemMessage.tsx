import { useI18n } from "../../i18n";

export default function SystemMessage({msg}:{msg:string}){
  const { t } = useI18n();
  const successMsg=['email sent.', "your password was reset."]
  return (
    <div
      className={`${!successMsg.includes(msg) ? 'text-red-500' : 'text-neutral-600'} max-w-[25em] text-sm font-medium`}
    >
      {t(msg)}
    </div>
  )
}
