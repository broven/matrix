import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Check, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { hasLocalServer } from "@/lib/platform";

interface ShareServerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverUrl: string;
  token: string;
  serverName?: string;
}

function buildConnectionUri(serverUrl: string, token: string): string {
  const params = new URLSearchParams({ serverUrl, token });
  return `matrix://connect?${params.toString()}`;
}

export function ShareServerModal({
  open,
  onOpenChange,
  serverUrl,
  token,
  serverName,
}: ShareServerModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState(serverUrl);
  const [lanIp, setLanIp] = useState<string | null>(null);

  // Reset stale state when server changes
  useEffect(() => {
    setLanIp(null);
    setShareUrl(serverUrl);
    setQrDataUrl("");
  }, [serverUrl]);

  // For local sidecar, fetch LAN IP so QR contains a LAN-reachable address
  useEffect(() => {
    if (!open) return;
    const isLocalhost = /localhost|127\.0\.0\.1/.test(serverUrl);
    if (!isLocalhost || !hasLocalServer()) {
      setShareUrl(serverUrl);
      return;
    }

    let cancelled = false;

    // Fetch LAN IP from local server
    fetch(`${serverUrl}/api/local-ip`)
      .then((res) => res.json())
      .then((data: { ip?: string }) => {
        if (cancelled) return;
        if (data.ip) {
          setLanIp(data.ip);
          const url = new URL(serverUrl);
          url.hostname = data.ip;
          setShareUrl(url.toString().replace(/\/$/, ""));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setShareUrl(serverUrl);
      });

    return () => { cancelled = true; };
  }, [open, serverUrl]);

  const connectionUri = buildConnectionUri(shareUrl, token);

  useEffect(() => {
    if (!open || !shareUrl || !token) {
      setQrDataUrl("");
      return;
    }

    void QRCode.toDataURL(connectionUri, {
      margin: 2,
      width: 280,
      color: { dark: "#000000", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [open, connectionUri, shareUrl, token]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(connectionUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <QrCode className="size-5" />
            Share Server
          </SheetTitle>
          <SheetDescription>
            {serverName
              ? `Share "${serverName}" with another device by scanning this QR code.`
              : "Scan this QR code from another Matrix client to connect."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col items-center gap-6 px-4">
          {/* QR Code */}
          <div className="rounded-2xl border border-border bg-white p-4">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Server connection QR code"
                width={280}
                height={280}
                className="rounded-xl"
              />
            ) : (
              <div className="flex size-[280px] items-center justify-center text-sm text-muted-foreground">
                Generating...
              </div>
            )}
          </div>

          {/* Connection info */}
          <div className="w-full space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Server URL
              </label>
              <Input readOnly value={shareUrl} className="font-mono text-xs" />
            </div>

            {lanIp && (
              <p className="text-xs text-muted-foreground">
                LAN address: {lanIp}
              </p>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Deep Link
              </label>
              <Input readOnly value={connectionUri} className="font-mono text-xs" />
            </div>

            <Button onClick={handleCopy} variant="outline" className="w-full">
              {copied ? (
                <>
                  <Check className="mr-2 size-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="mr-2 size-4" />
                  Copy Link
                </>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
