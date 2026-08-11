// Widget (iframe içi, apps/widget/src/App.tsx tarafından `vite build` ile
// build edilir) ile embed script'i (host sayfada çalışır, `embed/embed.ts`
// tarafından AYRI bir lib-mode build'le `dist/embed.js`'e derlenir, bkz.
// vite.embed.config.ts) arasındaki postMessage sözleşmesi burada
// tekilleştirildi — iki taraf da bu dosyayı import ediyor (iki ayrı Vite
// build hedefi olsa da kaynak dosya paylaşımı sorun değil, ikisi de aynı
// TS derleyicisiyle type-check ediliyor).
//
// `source` alanı bilinçli: postMessage her iki yönde de `targetOrigin: "*"`
// kullanmak zorunda (widget kendi kendini hangi origin'in gömdüğünü
// bilemez — embed script'i host'un origin'inden çalışır ama widget'a bunu
// söylemez; host da iframe navigasyonundan sonra widget'ın gerçek
// origin'ini garanti bilemeyebilir, ör. bir CDN üzerinden farklı bir path).
// Content zaten public (board/post verisi), bu yüzden "*" burada kabul
// edilebilir bir risk — ama gelen her mesajın gerçekten bizim
// protokolümüzden geldiğini `source` alanıyla doğrulamak (rastgele başka
// bir postMessage'ı yanlışlıkla işlememek için) yine de şart.
export const WIDGET_MESSAGE_SOURCE = "canny-mini-widget";
export const HOST_MESSAGE_SOURCE = "canny-mini-host";

export type WidgetTheme = "light" | "dark" | "auto";

// Widget (child) → host (parent)
export type WidgetToHostMessage =
  | { source: typeof WIDGET_MESSAGE_SOURCE; type: "ready" }
  | { source: typeof WIDGET_MESSAGE_SOURCE; type: "resize"; height: number };

// Host (parent) → widget (child)
export type HostToWidgetMessage = {
  source: typeof HOST_MESSAGE_SOURCE;
  type: "set-theme";
  theme: WidgetTheme;
};

export function isWidgetToHostMessage(
  data: unknown,
): data is WidgetToHostMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "source" in data &&
    (data as { source: unknown }).source === WIDGET_MESSAGE_SOURCE
  );
}

export function isHostToWidgetMessage(
  data: unknown,
): data is HostToWidgetMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "source" in data &&
    (data as { source: unknown }).source === HOST_MESSAGE_SOURCE
  );
}
