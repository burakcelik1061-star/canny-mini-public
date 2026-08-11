// Host sitenin ekleyeceği tek satır: `<script src=".../embed.js" data-org="acme"
// data-board="feedback" async></script>`. Bu dosya apps/widget'ın ana
// React uygulamasından AYRI, bağımsız bir Vite lib-mode build'i (bkz.
// vite.embed.config.ts) — React'e bağımlı değil, IIFE olarak tek dosyada
// (`dist/embed.js`) derlenir, host sayfaya React/JSX yükü bindirmez.
//
// widgetOrigin bilinçli olarak env değişkeni DEĞİL, script'in kendi src'sinden
// türetiliyor (`new URL(currentScript.src).origin`): embed.js her zaman
// widget'ın React uygulamasıyla (index.html + assets) AYNI dist/ klasöründen,
// dolayısıyla aynı origin'den sunulacak — bu da "widget nerede host
// ediliyorsa embed.js oradan otomatik doğru origin'i bulur" demek, ayrı bir
// yapılandırma adımı (ör. build-time env) gerekmiyor. `data-widget-origin`
// attribute'u yine de bir kaçış kapısı olarak destekleniyor (ör. bir CDN/proxy
// embed.js'i widget'tan farklı bir path'ten sunuyorsa).
import {
  isWidgetToHostMessage,
  HOST_MESSAGE_SOURCE,
  type WidgetTheme,
} from "../src/lib/embed-protocol";

const DEFAULT_HEIGHT_PX = 400;

function init(): void {
  const scriptEl = document.currentScript as HTMLScriptElement | null;
  if (!scriptEl) {
    // currentScript sadece senkron ilk çalıştırma sırasında güvenilir —
    // burada null geliyorsa script beklenmedik bir şekilde (ör. dinamik
    // eval) yüklenmiş demektir, sessizce vazgeçiyoruz.
    console.error("[canny-mini] embed script'i currentScript bulunamadı.");
    return;
  }

  const {
    org,
    board,
    theme,
    height,
    widgetOrigin: widgetOriginOverride,
    identifyEmail,
    identifyName,
    identifyTimestamp,
    identifySignature,
  } = scriptEl.dataset;

  if (!org || !board) {
    console.error(
      "[canny-mini] embed script'i data-org ve data-board attribute'larını gerektiriyor.",
    );
    return;
  }

  const widgetOrigin = widgetOriginOverride
    ? widgetOriginOverride.replace(/\/$/, "")
    : new URL(scriptEl.src, window.location.href).origin;

  const params = new URLSearchParams({ org, board });
  // Faz 4.3 — kimlik federasyonu: BU DEĞERLER HOST'UN KENDİ BACKEND'İNDE
  // org.widgetSecret ile imzalanmış olmalı (bkz. apps/api
  // AuthService.identifyWidgetUser) — embed script bunları sadece taşır,
  // asla kendisi hesaplamaz/doğrulamaz. Dördü de yoksa widget kendi login
  // formuna düşer (bkz. lib/target.ts → readIdentify, "hepsi ya da hiçbiri").
  if (identifyEmail && identifyName && identifyTimestamp && identifySignature) {
    params.set("identifyEmail", identifyEmail);
    params.set("identifyName", identifyName);
    params.set("identifyTs", identifyTimestamp);
    params.set("identifySig", identifySignature);
  }

  const iframe = document.createElement("iframe");
  iframe.src = `${widgetOrigin}/?${params.toString()}`;
  iframe.title = "Canny mini — geri bildirim panosu";
  iframe.style.width = "100%";
  iframe.style.border = "none";
  iframe.style.height = `${Number(height) || DEFAULT_HEIGHT_PX}px`;
  // Widget kendi post/oy verisini (public, org-scoped) çeker — sandbox
  // burada kimlik/çerez kısıtlamadığı bir "allow-same-origin allow-scripts
  // allow-forms allow-popups" seti kullanıyor: widget kendi origin'inde
  // localStorage'a (auth token) ve fetch'e ihtiyaç duyuyor, form submit'i
  // (login/post) tetikliyor, "Kayıt ol" gibi harici bir linke gitmiyor ama
  // ileride (4.3+) çıkabilir diye popup'a izin verildi.
  iframe.sandbox.add(
    "allow-same-origin",
    "allow-scripts",
    "allow-forms",
    "allow-popups",
  );

  scriptEl.insertAdjacentElement("afterend", iframe);

  const desiredTheme = isWidgetTheme(theme) ? theme : undefined;

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    // İki katmanlı doğrulama: mesaj gerçekten BİZİM bu çağrıda oluşturduğumuz
    // iframe'den mi geldi (event.source), ve gerçekten widget protokolüne mi
    // uyuyor (isWidgetToHostMessage) — sayfada başka embed script kopyaları
    // (başka board'lar) ya da widget'la ilgisiz postMessage'lar varsa
    // birbirine karışmasın.
    if (event.source !== iframe.contentWindow) {
      return;
    }
    if (!isWidgetToHostMessage(event.data)) {
      return;
    }
    if (event.data.type === "resize") {
      iframe.style.height = `${event.data.height}px`;
      return;
    }
    if (event.data.type === "ready" && desiredTheme) {
      // targetOrigin burada "*" değil widgetOrigin — host, widget'ın
      // origin'ini (kendi ürettiği src'den) kesin biliyor, bu yönde gevşek
      // davranmaya gerek yok (bkz. embed-protocol.ts'teki genel yorum).
      iframe.contentWindow?.postMessage(
        { source: HOST_MESSAGE_SOURCE, type: "set-theme", theme: desiredTheme },
        widgetOrigin,
      );
    }
  });
}

function isWidgetTheme(value: string | undefined): value is WidgetTheme {
  return value === "light" || value === "dark" || value === "auto";
}

init();
