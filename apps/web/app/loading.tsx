import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="size-10 animate-spin text-primary" />
    </div>
  );
}
