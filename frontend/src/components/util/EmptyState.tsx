import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export default function EmptyState({
  icon: Icon,
  message,
  children,
}: {
  icon: LucideIcon;
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex justify-center px-3 py-3">
      <div className="flex flex-col items-center gap-7 py-7">
        <div className="flex flex-col items-center gap-2 text-center text-sm font-medium leading-tight opacity-30">
          <Icon strokeWidth={1.2} className="h-12 w-12" aria-hidden="true" />
          {message}
        </div>
        {children}
      </div>
    </div>
  );
}
