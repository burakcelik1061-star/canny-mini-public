"use client";

// Faz 4.3 — Widget tema/kimlik ayarları. NAV_ITEMS'ta önceden "Faz 3.4"
// notuyla devre dışıydı (bkz. admin-shell.tsx) — o adımın gerçek işi admin
// yanıtı/status değişikliği oldu, "Ayarlar" sayfası hiç yazılmamıştı; burada
// ilk defa aktifleşiyor.

import { useEffect, useState, type FormEvent } from "react";
import { useAdminOrg } from "@/components/admin-shell";
import {
  ApiError,
  WIDGET_URL,
  getWidgetSettings,
  listOrgBoards,
  rotateWidgetSecret,
  updateWidgetSettings,
  type ApiBoard,
  type ApiWidgetSettings,
} from "@/lib/api";

export default function AdminSettingsPage() {
  const { org, accessToken } = useAdminOrg();
  const canEdit = org.role === "OWNER" || org.role === "ADMIN";

  const [settings, setSettings] = useState<ApiWidgetSettings | null>(null);
  const [boards, setBoards] = useState<ApiBoard[]>([]);
  const [selectedBoardSlug, setSelectedBoardSlug] = useState("");
  const [color, setColor] = useState("#171717");
  const [logoUrl, setLogoUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    if (!canEdit) {
      return;
    }
    let cancelled = false;
    Promise.all([
      getWidgetSettings(org.id, accessToken),
      listOrgBoards(org.id, accessToken),
    ])
      .then(([fetchedSettings, fetchedBoards]) => {
        if (cancelled) return;
        setSettings(fetchedSettings);
        setColor(fetchedSettings.color);
        setLogoUrl(fetchedSettings.logoUrl ?? "");
        setBoards(fetchedBoards);
        if (fetchedBoards.length > 0) {
          setSelectedBoardSlug(fetchedBoards[0].slug);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Ayarlar yüklenemedi");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [org.id, accessToken, canEdit]);

  async function handleSaveTheme(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSavedMessage(null);
    try {
      const updated = await updateWidgetSettings(org.id, accessToken, {
        color,
        logoUrl,
      });
      setSettings((prev) => (prev ? { ...prev, ...updated } : prev));
      setSavedMessage("Kaydedildi.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kaydedilemedi");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRotate() {
    if (
      !window.confirm(
        "Secret'ı yenilemek eski secret'la imzalanmış tüm identify isteklerini geçersiz kılar (host'un kendi backend'inin de güncellemesi gerekir). Emin misin?",
      )
    ) {
      return;
    }
    setRotating(true);
    setError(null);
    try {
      const { secret } = await rotateWidgetSecret(org.id, accessToken);
      setSettings((prev) => (prev ? { ...prev, secret } : prev));
      setShowSecret(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Secret yenilenemedi");
    } finally {
      setRotating(false);
    }
  }

  if (!canEdit) {
    return (
      <p className="text-sm text-zinc-500">
        Widget ayarlarını sadece OWNER/ADMIN rolündeki üyeler görebilir.
      </p>
    );
  }

  if (settings === null) {
    return <p className="text-sm text-zinc-500">Yükleniyor…</p>;
  }

  const embedSnippet = selectedBoardSlug
    ? `<script src="${WIDGET_URL}/embed.js" data-org="${org.slug}" data-board="${selectedBoardSlug}" async></script>`
    : null;
  const identifySnippet = `// Host'un KENDİ backend'i (Node.js örneği — bu kod widget'ta/tarayıcıda ÇALIŞMAZ):
const crypto = require("crypto");
const email = user.email;
const name = user.name;
const timestamp = Date.now();
// Mesajı AYNEN böyle oluştur (sıra ve biçim birebir aynı olmalı,
// yoksa imza doğrulanmaz):
const message = "widget-identify:v1:" + JSON.stringify([email, name, timestamp]);
const signature = crypto
  .createHmac("sha256", "${showSecret ? settings.secret : "<WIDGET_SECRET>"}")
  .update(message)
  .digest("hex");
// email/name/timestamp/signature'ı embed script'in data-identify-*
// attribute'larına ver (bkz. Embed kodu bölümü).`;

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <h1 className="text-xl font-semibold">Ayarlar</h1>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Tema
        </h2>
        <form onSubmit={handleSaveTheme} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <label htmlFor="widget-color" className="w-24 text-sm">
              Renk
            </label>
            <input
              id="widget-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 rounded border border-black/15 bg-transparent dark:border-white/20"
            />
            <span className="text-xs text-zinc-500">{color}</span>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="widget-logo" className="w-24 text-sm">
              Logo URL
            </label>
            <input
              id="widget-logo"
              type="url"
              placeholder="https://…"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              className="flex-1 rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {submitting ? "Kaydediliyor…" : "Kaydet"}
          </button>
          {savedMessage && (
            <p className="text-xs text-green-600 dark:text-green-400">
              {savedMessage}
            </p>
          )}
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Kimlik doğrulama (Identify)
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <strong>Opsiyonel.</strong> Normalde widget&apos;taki ziyaretçiler
          kendi giriş formundan giriş yapar. Bunun yerine, widget&apos;ı
          gömdüğün sitede <em>zaten giriş yapmış</em> kullanıcıları otomatik
          tanıtabilirsin — böylece ikinci kez giriş yapmaları gerekmez.
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nasıl çalışır: sitenin <strong>kendi sunucusu</strong> (tarayıcı
          değil), aşağıdaki secret ile kullanıcının e-posta ve adını imzalar;
          oluşan imzayı embed script&apos;e verir. Biz imzayı doğrulayıp o
          kullanıcıyı tanırız.
        </p>
        <p className="text-xs text-zinc-500">
          Secret&apos;ı asla tarayıcıya/istemci koduna koyma — sadece kendi
          sunucunda dursun. Sızdığını düşünüyorsan aşağıdan yenile (eski
          imzalar anında geçersiz olur).
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded border border-black/15 bg-black/[.03] px-3 py-2 text-xs dark:border-white/20 dark:bg-white/[.05]">
            {showSecret ? settings.secret : "•".repeat(48)}
          </code>
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className="shrink-0 text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {showSecret ? "Gizle" : "Göster"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => void handleRotate()}
          disabled={rotating}
          className="self-start text-xs text-red-600 underline hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
        >
          {rotating ? "Yenileniyor…" : "Secret'ı yenile"}
        </button>
        <pre className="whitespace-pre-wrap break-words rounded border border-black/15 bg-black/[.03] p-3 text-xs dark:border-white/20 dark:bg-white/[.05]">
          {identifySnippet}
        </pre>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Embed kodu
        </h2>
        {boards.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Önce bir board oluşturmalısın.
          </p>
        ) : (
          <>
            {boards.length > 1 && (
              <select
                value={selectedBoardSlug}
                onChange={(e) => setSelectedBoardSlug(e.target.value)}
                className="self-start rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.slug}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <pre className="whitespace-pre-wrap break-words rounded border border-black/15 bg-black/[.03] p-3 text-xs dark:border-white/20 dark:bg-white/[.05]">
              {embedSnippet}
            </pre>
            <p className="text-xs text-zinc-500">
              Bu kodu gömülecek sitenin HTML&apos;ine yapıştır. Kimlik
              doğrulama eklemek istersen (opsiyonel) yukarıdaki örnekle
              üretilen dört değeri <code>data-identify-email</code>,{" "}
              <code>data-identify-name</code>,{" "}
              <code>data-identify-timestamp</code>,{" "}
              <code>data-identify-signature</code> attribute&apos;u olarak
              script etiketine ekle.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
