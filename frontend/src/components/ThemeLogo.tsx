type ThemeLogoProps = {
  variant: "background" | "transparent";
  alt: string;
  className: string;
};

const logoSources = {
  background: {
    light: "/logo-background-light.png",
    dark: "/logo-background-dark.png",
  },
  transparent: {
    light: "/logo-transparent-light.png",
    dark: "/logo-transparent-dark.png",
  },
} as const;

export default function ThemeLogo({
  variant,
  alt,
  className,
}: ThemeLogoProps) {
  const sources = logoSources[variant];

  return (
    <>
      <img src={sources.light} alt={alt} className={`${className} dark:hidden`} />
      <img src={sources.dark} alt={alt} className={`${className} hidden dark:block`} />
    </>
  );
}
