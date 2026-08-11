import { useEffect, useState } from "react";
import { getBranding, type WidgetBranding } from "./api";
import { pickAccentTextColor } from "./color";

// Faz 4.3 — org'un widget rengini styles.css'teki `--cm-accent-*`
// değişkenlerine uyguluyor. `document.documentElement` üzerine yazıyoruz
// (useEmbedSync'in data-theme'i uyguladığı yerle aynı element) — widget
// tek bir org/board için tek bir sayfa olduğundan (bkz. lib/target.ts)
// global bir override burada sorun değil, aksine `.cm-button`/`.cm-tab--active`
// gibi zaten var olan sınıfları hiç değiştirmeden otomatik yeniden
// renklendiriyor.
//
// Branding çekilemezse (ağ hatası, org bulunamadı vb.) sessizce varsayılan
// renklerde (styles.css'in kendi `--cm-accent-bg` değeri) kalınır — bu,
// widget'ın asıl işlevini (board'u göstermek) engellememeli.
export function useBranding(orgSlug: string): WidgetBranding | null {
  const [branding, setBranding] = useState<WidgetBranding | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBranding(orgSlug)
      .then((result) => {
        if (!cancelled) setBranding(result);
      })
      .catch(() => {
        // Sessizce yut — bkz. yukarıdaki yorum.
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  useEffect(() => {
    if (!branding) {
      return;
    }
    document.documentElement.style.setProperty(
      "--cm-accent-bg",
      branding.color,
    );
    document.documentElement.style.setProperty(
      "--cm-accent-text",
      pickAccentTextColor(branding.color),
    );
    return () => {
      document.documentElement.style.removeProperty("--cm-accent-bg");
      document.documentElement.style.removeProperty("--cm-accent-text");
    };
  }, [branding]);

  return branding;
}
