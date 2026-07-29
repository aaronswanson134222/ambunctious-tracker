import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Copy,
  ExternalLink,
  ImageOff,
  LoaderCircle,
  ShoppingBag,
  Package,
  AlertTriangle,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type ProductDetailsInput = {
  productId: number;
  kind: "game_pass" | "developer_product";
  universeId: number | null;
  placeId: number | null;
  fallbackName?: string | null;
  fallbackCreatedAt?: string | null;
  experienceLabel?: string | null;
};

type DetailsResponse = {
  kind: "game_pass" | "developer_product";
  productId: number;
  universeId: number | null;
  placeId: number | null;
  name: string | null;
  description: string | null;
  priceInRobux: number | null;
  isForSale: boolean | null;
  iconImageAssetId: number | null;
  createdAt: string | null;
  thumbnailUrl: string | null;
  experienceName: string | null;
  creatorName: string | null;
  creatorType: string | null;
  creatorId: number | null;
  warnings: string[];
  source: string;
};

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Copy failed");
  }
}

function fieldRow(label: string, value: React.ReactNode) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="min-w-0 break-words">{value}</div>
    </div>
  );
}

export function ProductDetailsDialog({
  open,
  onOpenChange,
  input,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  input: ProductDetailsInput | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetailsResponse | null>(null);

  useEffect(() => {
    if (!open || !input) return;
    let cancelled = false;
    setData(null);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) throw new Error("Sign in to view product details");
        const res = await fetch("/api/roblox/product-details", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: Bearer $trailing
          },
          body: JSON.stringify({
            productId: input.productId,
            universeId: input.universeId,
            placeId: input.placeId,
            kind: input.kind,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Details unavailable");
        if (!cancelled) setData(body as DetailsResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Details unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, input]);

  if (!input) return null;
  const isPass = input.kind === "game_pass";
  const name =
    data?.name ??
    input.fallbackName ??
    (isPass ? `Game pass ${input.productId}` : `Developer product ${input.productId}`);
  const createdAt = data?.createdAt ?? input.fallbackCreatedAt ?? null;

  const luaSnippet =
    `local MarketplaceService = game:GetService("MarketplaceService")\n` +
    `-- Run inside the experience; a Player must trigger this.\n` +
    `MarketplaceService:PromptProductPurchase(player, ${input.productId})`;

  const storeUrl = input.placeId ? `https://www.roblox.com/games/${input.placeId}#!/store` : null;
  const experienceUrl = input.placeId ? `https://www.roblox.com/games/${input.placeId}` : null;
  const creatorHubUrl = input.universeId
    ? `https://create.roblox.com/dashboard/creations/experiences/${input.universeId}/monetization/developer-products`
    : null;
  const passUrl = isPass ? `https://www.roblox.com/game-pass/${input.productId}` : null;

  const compactJson = JSON.stringify(
    {
      kind: input.kind,
      productId: input.productId,
      universeId: input.universeId,
      placeId: input.placeId,
      name,
      priceInRobux: data?.priceInRobux ?? null,
      createdAt,
      experience: data?.experienceName ?? input.experienceLabel ?? null,
      creator: data?.creatorName ?? null,
    },
    null,
    2,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            {isPass ? (
              <Package className="h-5 w-5 text-primary" />
            ) : (
              <ShoppingBag className="h-5 w-5 text-primary" />
            )}
            <span className="truncate">{name}</span>
          </DialogTitle>
          <DialogDescription className="text-left">
            {isPass ? "Roblox game pass" : "Roblox developer product"} · ID #{input.productId}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading Roblox details…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-background">
            {data?.thumbnailUrl ? (
              <img src={data.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : loading ? (
              <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <ImageOff className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {fieldRow("Product ID", <span className="font-mono">{input.productId}</span>)}
            {fieldRow("Type", isPass ? "Game pass" : "Developer product")}
            {fieldRow(
              "Price",
              data?.priceInRobux != null ? (
                <span className="font-medium">R$ {data.priceInRobux.toLocaleString()}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
            )}
            {fieldRow(
              "For sale",
              data?.isForSale == null ? (
                <span className="text-muted-foreground">Unknown</span>
              ) : data.isForSale ? (
                "Yes"
              ) : (
                "No"
              ),
            )}
            {fieldRow(
              "Created",
              createdAt ? (
                new Date(createdAt).toLocaleString()
              ) : (
                <span className="text-muted-foreground">Unknown</span>
              ),
            )}
            {fieldRow(
              "Experience",
              data?.experienceName ?? input.experienceLabel ?? (
                <span className="text-muted-foreground">—</span>
              ),
            )}
            {fieldRow(
              "Place ID",
              input.placeId ?? <span className="text-muted-foreground">—</span>,
            )}
            {fieldRow(
              "Universe ID",
              input.universeId ?? <span className="text-muted-foreground">—</span>,
            )}
            {fieldRow(
              "Creator",
              data?.creatorName ? (
                `${data.creatorName}${data.creatorType ? ` (${data.creatorType})` : ""}`
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
            )}
          </div>
        </div>

        {data?.description && (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
            <p className="mt-1 whitespace-pre-wrap rounded-md border border-white/10 bg-background/40 p-3 text-sm">
              {data.description}
            </p>
          </div>
        )}

        {data?.warnings?.length ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <Info className="h-4 w-4 shrink-0" />
            <ul className="list-disc space-y-1 pl-4">
              {data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyText(String(input.productId), "Product ID")}
          >
            <Copy /> Copy Product ID
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!input.universeId}
            onClick={() =>
              input.universeId && void copyText(String(input.universeId), "Universe ID")
            }
          >
            <Copy /> Copy Universe ID
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!input.placeId}
            onClick={() => input.placeId && void copyText(String(input.placeId), "Place ID")}
          >
            <Copy /> Copy Place ID
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyText(compactJson, "JSON")}>
            <Copy /> Copy JSON
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {passUrl && (
            <a
              href={passUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium hover:border-primary hover:bg-primary/20"
            >
              Open game pass page <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {storeUrl && (
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm hover:border-primary/50 hover:text-primary"
            >
              Open Experience Store (generic Store tab) <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {experienceUrl && (
            <a
              href={experienceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm hover:border-primary/50 hover:text-primary"
            >
              Open Experience <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {creatorHubUrl && (
            <a
              href={creatorHubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm hover:border-primary/50 hover:text-primary"
            >
              Open Creator Hub (owners only) <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {!isPass && (
          <div className="space-y-2 rounded-md border border-white/10 bg-background/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Purchase / Test</p>
            <p className="text-xs text-muted-foreground">
              Individual developer products have no public roblox.com detail URL. Purchases must be
              prompted from inside the experience via{" "}
              <code>MarketplaceService:PromptProductPurchase</code>. This website cannot trigger a
              purchase directly.
            </p>
            <div className="flex flex-wrap gap-2">
              {experienceUrl && (
                <a
                  href={experienceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium hover:border-primary"
                >
                  Open experience to purchase <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyText(luaSnippet, "LocalScript snippet")}
              >
                <Copy /> Copy LocalScript snippet
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-md border border-white/10 bg-background/60 p-2 text-[11px] leading-relaxed">
              {luaSnippet}
            </pre>
          </div>
        )}

        {data?.source && (
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Source: {data.source}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}


