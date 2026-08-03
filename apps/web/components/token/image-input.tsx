"use client";

import Compressor from "compressorjs";
import { Loader2, Pencil, Upload } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { cn } from "@lcai/ui/lib/utils";

type ImageInputProps = {
  onChange?: (file: File | null) => void;
  preview?: string;
  isLoading?: boolean;
};

function isImage(file: File) {
  return /image.*/.test(file.type);
}

async function compressImage(file: File) {
  return new Promise<File>((resolve, reject) => {
    new Compressor(file, {
      quality: 0.8,
      maxWidth: 500,
      maxHeight: 500,
      success: (result) => resolve(result as File),
      error: reject,
    });
  });
}

export function ImageInput({ preview, isLoading, onChange }: ImageInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [file, setFile] = useState<File | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLoading) return;
    let picked = e.target.files?.[0];
    if (picked && isImage(picked)) {
      picked = await compressImage(picked);
      setFile(picked);
    }
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  useEffect(() => {
    onChangeRef.current?.(file);
  }, [file]);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl",
          "border-2 border-dashed border-border bg-muted/30 transition hover:border-primary/50",
        )}
      >
        {isLoading && <Loader2 className="size-6 animate-spin text-primary" />}
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Preview" className="h-full w-full rounded-xl object-cover" />
            <span className="absolute bottom-2 right-2 rounded-full bg-primary p-2 text-primary-foreground">
              <Pencil size={14} />
            </span>
          </>
        ) : (
          <>
            <Image src="/images/icons/upload-icon.png" width={33} height={33} alt="" />
            <span className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Upload size={16} /> Select Media
            </span>
          </>
        )}
      </button>
    </div>
  );
}
