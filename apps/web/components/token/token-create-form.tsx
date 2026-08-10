"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as zod from "zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useConnection } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { AxiosError } from "axios";

import { ImageInput } from "@/components/token/image-input";
import { BrandButton } from "@/components/ui/brand-button";
import { $http } from "@/lib/http";
import useTradeFunctions from "@/hooks/useTradeFunctions";
import { Input } from "@lcai/ui/components/input";
import { Label } from "@lcai/ui/components/label";
import { Textarea } from "@lcai/ui/components/textarea";
import { Card, CardContent } from "@lcai/ui/components/card";
import { cn } from "@lcai/ui/lib/utils";

const httpsRule = zod
  .string()
  .trim()
  .refine((v) => v === "" || /^https:\/\/.+/i.test(v), { message: "must be an https URL" })
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const schema = zod.object({
  name: zod.string().trim().min(1, "Token name is required").max(64),
  symbol: zod.string().trim().min(1, "Token symbol is required").max(16),
  description: zod.string().trim().min(1, "Description is required").max(2000),
  website: httpsRule,
  twitter: httpsRule,
  telegram: httpsRule,
  discord: httpsRule,
  tag: zod.string().min(1, "Pick a tag"),
});

type FormValues = zod.infer<typeof schema>;
const TAGS = ["Meme", "AI", "DEFI", "Games", "Infra", "Other"] as const;
type MetadataResponse = { uri: string; imageUri: string };

export function TokenCreateForm() {
  const router = useRouter();
  const { isConnected, address } = useConnection();
  const { open } = useAppKit();
  const { createToken, assertCanAffordCreation } = useTradeFunctions();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      symbol: "",
      description: "",
      website: "",
      twitter: "",
      telegram: "",
      discord: "",
      tag: "",
    },
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | undefined>();
  const pinnedRef = useRef<{ key: string; uri: string } | null>(null);

  const pinMetadata = useMutation({
    mutationFn: async ({ values, file }: { values: FormValues; file: File }) => {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("name", values.name);
      formData.append("symbol", values.symbol);
      formData.append("description", values.description);
      if (values.website) formData.append("website", values.website);
      if (values.twitter) formData.append("twitter", values.twitter);
      if (values.telegram) formData.append("telegram", values.telegram);
      if (values.discord) formData.append("discord", values.discord);
      formData.append("tags", values.tag);
      const { data } = await $http.post<MetadataResponse>("/metadata", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
    onError: (error: AxiosError<{ error: string }>) => {
      toast.error(error.response?.data?.error || error.message || "Pinning failed");
    },
  });

  const mintToken = useMutation({
    mutationFn: createToken,
    onSuccess: (result) => {
      if (result) {
        toast.success("Token created — indexing on chain…");
        router.push(`/token/${result.tokenAddress}`);
      }
    },
    onError: (err: { walk?: () => { message: string }; message?: string }) => {
      toast.error(err?.walk?.()?.message || err?.message || "Signing failed");
    },
  });

  const isPending = pinMetadata.isPending || mintToken.isPending;

  const onSubmit = async (values: FormValues) => {
    if (!address) return;
    if (!imageFile) {
      toast.error("Please pick an image");
      return;
    }
    try {
      await assertCanAffordCreation();
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }

    // A rejected/failed tx leaves the pin valid — reuse it on resubmit unless
    // the form or the image changed.
    const key = JSON.stringify([
      values,
      imageFile.name,
      imageFile.size,
      imageFile.lastModified,
    ]);
    if (pinnedRef.current?.key !== key) {
      const { uri } = await pinMetadata.mutateAsync({ values, file: imageFile });
      pinnedRef.current = { key, uri };
    }

    await mintToken.mutateAsync({
      name: values.name,
      symbol: values.symbol,
      metadataURI: pinnedRef.current.uri,
    });
  };

  return (
    <Card className="mx-auto max-w-2xl border-border/60">
      <CardContent className="p-8">
        <form
          onSubmit={
            isConnected
              ? handleSubmit(onSubmit)
              : (e) => {
                e.preventDefault();
                open();
              }
          }
          className="space-y-6"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Token Name</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="symbol">Token Symbol</Label>
            <Input id="symbol" {...register("symbol")} />
            {errors.symbol && <p className="text-sm text-destructive">{errors.symbol.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Image</Label>
            <ImageInput
              preview={imagePreview}
              onChange={(file) => {
                setImageFile(file);
                setImagePreview(file ? URL.createObjectURL(file) : undefined);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={5} {...register("description")} />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>

          {(["website", "twitter", "telegram", "discord"] as const).map((field) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={field} className="capitalize">
                {field}
              </Label>
              <Input id={field} placeholder="https://… (optional)" {...register(field)} />
              {errors[field] && (
                <p className="text-sm text-destructive">{errors[field]?.message}</p>
              )}
            </div>
          ))}

          <div className="space-y-2">
            <Label>Tag</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TAGS.map((item) => (
                <label
                  key={item}
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2 text-sm",
                    "has-[:checked]:border-primary has-[:checked]:bg-primary/10",
                  )}
                >
                  <input type="radio" value={item} className="sr-only" {...register("tag")} />
                  {item}
                </label>
              ))}
            </div>
            {errors.tag && <p className="text-sm text-destructive">{errors.tag.message}</p>}
          </div>

          <BrandButton type="submit" className="w-full" disabled={isPending}>
            {isConnected ? (isPending ? "Submitting…" : "Submit") : "Connect Wallet"}
          </BrandButton>
        </form>
      </CardContent>
    </Card>
  );
}
