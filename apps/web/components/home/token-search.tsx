"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { cn } from "@lcai/ui/lib/utils";

const FILTERS: { label: string; params: Record<string, string | null> }[] = [
  { label: "Newest", params: { sort: null, status: null } },
  { label: "Top Market Cap", params: { sort: "marketCap", status: "all" } },
  { label: "Graduated", params: { sort: "marketCap", status: "graduated" } },
];

export function TokenSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  const pushParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    router.push(`/?${params.toString()}`);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    pushParams({ q: q.trim() || null });
  };

  const activeFilter = (() => {
    const sort = searchParams.get("sort");
    const status = searchParams.get("status");
    const found = FILTERS.find((f) => (f.params.sort ?? null) === sort && (f.params.status ?? null) === status);
    return found?.label ?? "Newest";
  })();

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => pushParams(f.params)}
            className={cn("chip", activeFilter === f.label && "chip-active")}
          >
            {f.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="relative w-full lg:max-w-sm">
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or symbol…"
          className="h-12 w-full rounded-full border border-border/60 bg-card/50 pl-11 pr-4 text-sm text-foreground outline-none backdrop-blur-md transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
        />
      </form>
    </div>
  );
}
