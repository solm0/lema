import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export default function TextButton({
  text, icon, onClick, disabled = false, fit = false, black = false, red = false,
}: {
  text: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  fit?: boolean;
  black?: boolean;
  red?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      className={`
        rounded-full text-sm cursor-pointer transition-colors font-medium px-4 inline-flex items-center justify-center gap-1
        ${fit ? 'h-12 md:h-10 w-full' : 'h-12 md:h-10 w-auto'}
        ${disabled ? 'opacity-30 pointer-events-none' : 'opacity-100 pointer-events-auto'}
        ${black ? 'text-neutral-200 bg-neutral-700 hover:bg-neutral-900 hover:text-neutral-100' : 'text-neutral-600 hover:text-neutral-700 bg-neutral-100 border border-neutral-200 hover:bg-neutral-200'}
        ${red && 'bg-red-200 hover:bg-red-300 border-0 text-red-800 hover:text-red-800'}
      `}
      onClick={() => onClick()}
    >
      {icon}
      <span>{text}</span>
    </button>
  )
}

export function LinkButton({
  text, link, disabled = false
}: {
  text: string;
  link: string;
  disabled?: boolean;
}) {
  return (
    <Link
      to={link}
      className={`
        hover:opacity-100 cursor-pointer transition-opacity
        ${disabled ? 'opacity-40 pointer-events-none' : 'opacity-70 pointer-events-auto'}
      `}
    >
      <span>{text}</span>
    </Link>
  )
}

export function IconButton({
  icon, onClick, disabled = false, title, active = false, mobileMenu = false, red = false
}: {
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  mobileMenu?: boolean;
  red?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      className={`
        aspect-square p-1 rounded transition-colors cursor-pointer flex items-center justify-center
        ${disabled ? 'opacity-40 pointer-events-none' : 'opacity-100 pointer-events-auto'}
        ${red ? 'text-red-600 hover:bg-red-200/30' : mobileMenu 
          ? active ? '' : 'text-neutral-400'
          : active ? 'bg-neutral-200 text-neutral-600' : 'bg-transparent hover:bg-neutral-200/50 text-neutral-500'
        }
      `}
      onClick={() => onClick()}
      title={title}
    >
      {icon}
    </button>
  )
}

export function IconButtonEvent({
  icon, onClick, disabled = false, title, red = false
}: {
  icon: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  title?: string;
  red?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      className={`
        w-10 h-10 md:w-8 md:h-8
        aspect-square p-3 md:p-2 rounded-full transition-colors cursor-pointer flex items-center justify-center
        ${red ? 'text-red-600 hover:bg-red-200/30' : 'text-neutral-600 md:text-neutral-500 hover:text-neutral-600 bg-neutral-200 md:bg-transparent md:hover:bg-neutral-200'}

        ${disabled ? 'opacity-40 pointer-events-none' : 'opacity-100 pointer-events-auto'}
      `}
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );
}
