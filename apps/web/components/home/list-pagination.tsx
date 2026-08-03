"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

import type { PageMeta } from "@/types";
import { cn } from "@lcai/ui/lib/utils";

export function ListPagination({ meta }: { meta: PageMeta }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (meta.totalPages <= 1) return null;

  const pageUrl = (page: number) => {
    const query = new URLSearchParams(searchParams.toString());
    query.set("page", String(page));
    return `${pathname}?${query.toString()}`;
  };

  const prevPage = meta.hasPrevPage ? meta.page - 1 : null;
  const nextPage = meta.hasNextPage ? meta.page + 1 : null;

  const pages: number[] = [];
  const start = Math.max(1, meta.page - 1);
  const end = Math.min(meta.totalPages, meta.page + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <nav className="mt-12 flex items-center justify-center gap-2">
      {prevPage ? (
        <Link
          href={pageUrl(prevPage)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border hover:bg-muted"
        >
          <ChevronLeft size={18} />
        </Link>
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border opacity-40">
          <ChevronLeft size={18} />
        </span>
      )}

      {pages.map((p) => (
        <Link
          key={p}
          href={pageUrl(p)}
          className={cn(
            "flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm",
            p === meta.page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted",
          )}
        >
          {p}
        </Link>
      ))}

      {nextPage ? (
        <Link
          href={pageUrl(nextPage)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border hover:bg-muted"
        >
          <ChevronRight size={18} />
        </Link>
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border opacity-40">
          <ChevronRight size={18} />
        </span>
      )}
    </nav>
  );
}
