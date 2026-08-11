import { useEffect, useState } from "react";
import { widgetIdentify } from "./api";
import { saveAuth, type StoredAuth } from "./auth-storage";
import { readIdentify } from "./target";

export type IdentifyStatus = "skip" | "pending" | "failed";

// Faz 4.3 — embed.ts (host) `data-identify-*` attribute'larını verdiyse
// (bkz. lib/target.ts → readIdentify), widget kendi login formunu hiç
// göstermeden host'un onayladığı kullanıcı olarak "giriş yapar". Params
// yoksa ya da zaten bir oturum varsa (localStorage'dan, 4.1'deki gibi)
// "skip" — App.tsx bu durumda normal AuthForms'u gösterir, bu "anonim ya
// da identify edilmiş" ayrımının widget tarafındaki karşılığı (bkz.
// AuthService.identifyWidgetUser'ın yorumu).
export function useWidgetIdentify(
  orgSlug: string,
  auth: StoredAuth | null,
): IdentifyStatus {
  const identify = readIdentify();
  const [status, setStatus] = useState<IdentifyStatus>(
    identify && !auth ? "pending" : "skip",
  );

  useEffect(() => {
    if (!identify || auth) {
      return;
    }
    let cancelled = false;
    widgetIdentify(orgSlug, identify)
      .then((result) => {
        // saveAuth localStorage'ı güncelleyip useStoredAuth'u tetikler —
        // App.tsx'in bir sonraki render'ında `auth` dolu gelir, bu effect
        // de (auth artık truthy olduğu için) tekrar çalışmaz.
        if (!cancelled) saveAuth(result);
      })
      .catch(() => {
        // İmza geçersiz/süresi dolmuş/org secret'ı yanlış — widget kendi
        // login formuna düşer, sessizce çökmez (host'un yanlış yapılandırmış
        // olması widget'ın temel işlevini (board'u göstermek) engellememeli).
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identify sabit query string'ten okunuyor (board-page.tsx'teki auth?.accessToken deseniyle aynı), sadece orgSlug/auth değişince tetiklensin istiyoruz
  }, [orgSlug, auth]);

  return status;
}
