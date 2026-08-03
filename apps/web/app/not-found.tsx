import Link from "next/link";

import { BrandButton } from "@/components/ui/brand-button";

export default function NotFound() {
  return (
    <div className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="theme-gradient text-6xl font-bold">404</h1>
      <p className="mt-4 text-lg text-muted-foreground">Page not found</p>
      <BrandButton href="/" className="mt-8">
        Back to Home
      </BrandButton>
    </div>
  );
}
