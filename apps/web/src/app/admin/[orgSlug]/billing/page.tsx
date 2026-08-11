"use client";

// Faz 6.3 — Billing sayfası. Faz 6.1'in checkout akışı ve Faz 6.2'nin plan
// limitleri artık burada tek bir yerde toplanıyor: mevcut plan, fatura
// geçmişi, ve kart güncelleme/iptal akışı (mock bir Stripe Customer Portal
// üzerinden — bkz. apps/api/src/billing/billing.controller.ts →
// mockPortalPage). Önceden bu sayfanın "Plan" kısmı Ayarlar sayfasındaydı
// (6.1'de eklendiği yer) — 6.3 ile buraya taşındı, Ayarlar artık sadece
// widget tema/kimlik/embed konularına odaklı.

import { useEffect, useState } from "react";
import { useAdminOrg } from "@/components/admin-shell";
import {
  API_BASE_URL,
  ApiError,
  createCheckoutSession,
  createPortalSession,
  getBillingOverview,
  type ApiBillingOverview,
} from "@/lib/api";

// Intl.NumberFormat: apps/api'nin amountCents/currency'sini ("2900"/"usd")
// insan-okunur bir para birimine çeviriyor — backend hiçbir zaman
// biçimlendirilmiş bir string döndürmüyor (STATUS_LABELS'daki gibi "sunum
// backend'in işi değil" ayrımı).
function formatAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

export default function AdminBillingPage() {
  const { org, accessToken } = useAdminOrg();
  const canManage = org.role === "OWNER" || org.role === "ADMIN";

  const [overview, setOverview] = useState<ApiBillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    getBillingOverview(org.id, accessToken)
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Billing bilgisi yüklenemedi");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [org.id, accessToken, canManage]);

  // Faz 6.1'deki checkout akışı — artık Ayarlar değil burada tetikleniyor.
  async function handleUpgrade() {
    setRedirecting(true);
    setError(null);
    try {
      const { url } = await createCheckoutSession(org.id, accessToken, {
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- hedef bir Next.js sayfası değil, cross-origin apps/api'nin (mock Stripe checkout) kendisi
      window.location.href = `${API_BASE_URL}${url}`;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Checkout başlatılamadı");
      setRedirecting(false);
    }
  }

  // Mock Stripe Customer Portal — kart güncelleme (placeholder) + gerçek
  // bir iptal akışı barındırıyor (bkz. mockPortalPage).
  async function handleManageBilling() {
    setRedirecting(true);
    setError(null);
    try {
      const { url } = await createPortalSession(org.id, accessToken, {
        returnUrl: window.location.href,
      });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- hedef bir Next.js sayfası değil, cross-origin apps/api'nin (mock Stripe portal) kendisi
      window.location.href = `${API_BASE_URL}${url}`;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Portal açılamadı");
      setRedirecting(false);
    }
  }

  if (!canManage) {
    return (
      <p className="text-sm text-zinc-500">
        Billing bilgilerini sadece OWNER/ADMIN rolündeki üyeler görebilir.
      </p>
    );
  }

  if (overview === null) {
    return error ? (
      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
    ) : (
      <p className="text-sm text-zinc-500">Yükleniyor…</p>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <h1 className="text-xl font-semibold">Billing</h1>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Plan
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Mevcut plan: <strong>{overview.plan === "PRO" ? "Pro" : "Free"}</strong>
        </p>

        {overview.plan === "FREE" ? (
          <>
            <button
              type="button"
              onClick={() => void handleUpgrade()}
              disabled={redirecting}
              className="self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
            >
              {redirecting ? "Yönlendiriliyor…" : "Pro'ya yükselt"}
            </button>
            <p className="text-xs text-zinc-500">
              Gerçek bir Stripe hesabı bağlı olmadığı için bu buton mock bir
              checkout sayfasına götürür.
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleManageBilling()}
              disabled={redirecting}
              className="self-start rounded-full border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.03] disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/[.06]"
            >
              {redirecting ? "Yönlendiriliyor…" : "Kart & abonelik yönetimi"}
            </button>
            <p className="text-xs text-zinc-500">
              Kart güncelleme/abonelik iptal — gerçek bir Stripe hesabı bağlı
              olmadığı için mock bir Customer Portal&apos;a götürür.
            </p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Fatura geçmişi
        </h2>
        {overview.invoices.length === 0 ? (
          <p className="text-sm text-zinc-500">Henüz bir fatura yok.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="pb-2 font-medium">Tarih</th>
                <th className="pb-2 font-medium">Açıklama</th>
                <th className="pb-2 text-right font-medium">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {overview.invoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  className="border-t border-black/10 dark:border-white/10"
                >
                  <td className="py-2">
                    {new Date(invoice.createdAt).toLocaleDateString("tr-TR")}
                  </td>
                  <td className="py-2">{invoice.description}</td>
                  <td className="py-2 text-right">
                    {formatAmount(invoice.amountCents, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
