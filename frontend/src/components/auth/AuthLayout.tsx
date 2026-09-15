import { Outlet } from "react-router-dom";
import ThemeLogo from "../ThemeLogo";

export default function AuthLayout() {
  return (
    <div className="relative w-screen h-screen flex flex-col items-center p-7 bg-neutral-50 text-neutral-900">
      <div className="w-full max-w-100 flex flex-col gap-14 items-start mt-28">
        <ThemeLogo
          variant="transparent"
          alt="Lema"
          className="size-36 object-contain select-none"
        />
        <div className="flex flex-col gap-14 w-full">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
