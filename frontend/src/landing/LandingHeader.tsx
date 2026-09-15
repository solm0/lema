import { Link } from "react-router-dom";
import ThemeLogo from "../components/ThemeLogo";

function LandingHeader({ homeHref }: { homeHref: string }) {
  return (
    <header className="fixed top-4 left-4 z-[60] size-12 bg-transparent select-none md:top-7 md:left-7 md:size-24">
      <Link to={homeHref} aria-label="Lema 홈으로 이동" className="block size-full">
        <ThemeLogo
          variant="transparent"
          alt=""
          className="size-full object-contain"
        />
      </Link>
    </header>
  );
}

export default LandingHeader;
