// App.tsx dışına taşındı: eslint-plugin-react-refresh, bir bileşen dosyasının
// (Fast Refresh'in düzgün çalışması için) sadece bileşen export etmesini
// istiyor — readTarget/readIdentify saf fonksiyonlar, App.test.ts da
// (App.tsx değil) bunları import ediyor.
export function readTarget(): { org: string; board: string } | null {
  const params = new URLSearchParams(window.location.search);
  const org = params.get("org");
  const board = params.get("board");
  if (!org || !board) {
    return null;
  }
  return { org, board };
}

export interface IdentifyParams {
  email: string;
  name: string;
  timestamp: number;
  signature: string;
}

// Faz 4.3 — embed.ts (host) bu dört query param'ı iframe src'sine
// `data-identify-*` attribute'larından geçiriyor (bkz. embed/embed.ts).
// İkisinden biri eksikse ya da timestamp sayı değilse widget "identify
// edilmemiş" (4.1'deki kendi login formu) moduna sessizce düşer — bkz.
// App.tsx'teki kullanım, `isWidgetTheme` gibi permissive bir type guard.
export function readIdentify(): IdentifyParams | null {
  const params = new URLSearchParams(window.location.search);
  const email = params.get("identifyEmail");
  const name = params.get("identifyName");
  const timestampRaw = params.get("identifyTs");
  const signature = params.get("identifySig");
  if (!email || !name || !timestampRaw || !signature) {
    return null;
  }
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return { email, name, timestamp, signature };
}
