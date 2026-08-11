import { useEffect, useRef, type RefObject } from "react";
import {
  isHostToWidgetMessage,
  WIDGET_MESSAGE_SOURCE,
  type WidgetTheme,
} from "./embed-protocol";

// Widget bir iframe içine gömülüyken (4.1) host sayfa widget'ın gerçek
// içerik yüksekliğini bilemez (iframe'in kendi CSS'i host'a görünmez) —
// embed script'i (embed/embed.ts) bunun için sabit bir başlangıç
// yüksekliği veriyordu. Bu hook, kök elemanın gerçek yüksekliğini
// ResizeObserver ile izleyip host'a postMessage ile bildiriyor; host da
// iframe'in `height` stilini buna göre güncelliyor (bkz. embed.ts →
// "resize" handler'ı). Ayrıca host'tan gelen "set-theme" mesajını dinleyip
// `<html data-theme="...">` uyguluyor — styles.css'teki
// `prefers-color-scheme` medya sorgularının yanına eklenen
// `[data-theme="dark"]`/`[data-theme="light"]` override'ları bunu okuyor
// (Artifact'lardaki aynı desen: media query varsayılan, data-theme kazanır).
//
// Widget iframe DIŞINDA (doğrudan tarayıcıda, 4.1'deki gibi) da çalışır —
// `window.parent === window` ise postMessage hiçbir şeye gitmez ama
// zararsızdır (parent kendi kendine mesaj gönderir, aşağıdaki mesaj
// dinleyici sadece `HOST_MESSAGE_SOURCE` işaretli mesajları işlediği için
// bu döngü bir şey tetiklemez).
export function useEmbedSync(rootRef: RefObject<HTMLElement | null>): void {
  const isEmbedded = useRef(
    typeof window !== "undefined" && window.parent !== window,
  );

  useEffect(() => {
    if (!isEmbedded.current) {
      return;
    }
    window.parent.postMessage(
      { source: WIDGET_MESSAGE_SOURCE, type: "ready" },
      "*",
    );
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || !isEmbedded.current) {
      return;
    }
    let lastReported = -1;
    const observer = new ResizeObserver((entries) => {
      const height = Math.ceil(entries[0].contentRect.height);
      if (height === lastReported) {
        return;
      }
      lastReported = height;
      window.parent.postMessage(
        { source: WIDGET_MESSAGE_SOURCE, type: "resize", height },
        "*",
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    function handleMessage(event: MessageEvent<unknown>) {
      if (!isHostToWidgetMessage(event.data)) {
        return;
      }
      if (event.data.type === "set-theme") {
        applyTheme(event.data.theme);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
}

function applyTheme(theme: WidgetTheme): void {
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}
