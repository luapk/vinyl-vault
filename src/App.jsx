import { lazy, Suspense } from "react";
import VinylVault from "./components/VinylVault.jsx";

// Audition page for carousel concepts, reached via ?lab=carousel.
// Lazy so it never ships in the main app bundle path.
const CarouselLab = lazy(() => import("./components/CarouselLab.jsx"));

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("lab") === "carousel") {
    return (
      <Suspense fallback={null}>
        <CarouselLab />
      </Suspense>
    );
  }
  return <VinylVault />;
}
