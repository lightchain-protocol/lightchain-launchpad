import { Button } from "@lcai/ui/components/button";
import { cn } from "@lcai/ui/lib/utils";
import Link from "next/link";
import type { ComponentProps } from "react";

type BrandButtonProps = Omit<ComponentProps<typeof Button>, "variant"> & {
  href?: string;
  brandVariant?: "primary" | "outline" | "ghost";
};

export function BrandButton({
  className,
  brandVariant = "primary",
  href,
  children,
  ...props
}: BrandButtonProps) {
  const styles = cn(
    "rounded-full px-6 py-2.5 text-sm font-semibold transition-all",
    brandVariant === "primary" &&
      "bg-primary text-primary-foreground shadow-[0_0_20px_rgba(112,100,233,0.35)] hover:brightness-110",
    brandVariant === "outline" &&
      "border border-primary/50 bg-transparent text-foreground hover:bg-primary/10",
    brandVariant === "ghost" && "bg-transparent text-muted-foreground hover:text-foreground",
    className,
  );

  if (href) {
    return (
      <Button asChild className={styles} {...props}>
        <Link href={href}>{children}</Link>
      </Button>
    );
  }

  return (
    <Button className={styles} {...props}>
      {children}
    </Button>
  );
}
