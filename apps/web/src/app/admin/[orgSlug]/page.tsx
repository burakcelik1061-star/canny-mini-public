"use client";

// Faz 3.1 — Admin dashboard iskeletinin "Genel Bakış" sayfası. İçerik
// bilinçli olarak minimal: bu adımın kapsamı layout + sidebar + org
// switcher (bkz. docs/prompt-library.md → 3.1). Board yönetimi (CRUD UI)
// ayrı bir adım değil ama board CRUD API'si zaten 2.1'den beri var — burada
// sadece salt-okunur bir liste, org-scoped veri akışının (GET
// /organizations/:orgId/boards) skeleton üzerinden gerçekten çalıştığını
// göstermek için.
//
// Faz 6.2 — "oluşturma" formu ilk kez burada eklendi (tam bir board yönetim
// UI'ı değil): plan limitinin (FREE org'un ilk board'dan sonra
// PlanLimitExceededException alması) tarayıcıda gerçekten tetiklenip
// "Pro'ya yükselt"e yönlendirebilecek bir yol olması gerekiyordu.

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAdminOrg } from "@/components/admin-shell";
import {
  ApiError,
  createBoard,
  listOrgBoards,
  type ApiBoard,
} from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export default function AdminOrgDashboardPage() {
  const { org, accessToken } = useAdminOrg();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{org.name}</h1>
        <p className="text-sm text-zinc-500">
          Rolün: {ROLE_LABELS[org.role] ?? org.role}
        </p>
      </div>

      {/* org değişince (sidebar'daki switcher ile) alttaki state'in
          sıfırdan kurulması için key=org.id — [orgSlug]/[boardSlug]/page.tsx'teki
          sort/status/search remount deseniyle aynı yaklaşım, effect
          içinde setState ile "sıfırla" yerine. */}
      <BoardsSection
        key={org.id}
        orgId={org.id}
        orgSlug={org.slug}
        canManage={org.role === "OWNER" || org.role === "ADMIN"}
        accessToken={accessToken}
      />
    </div>
  );
}

function BoardsSection({
  orgId,
  orgSlug,
  canManage,
  accessToken,
}: {
  orgId: string;
  orgSlug: string;
  canManage: boolean;
  accessToken: string;
}) {
  const [boards, setBoards] = useState<ApiBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planLimitHit, setPlanLimitHit] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listOrgBoards(orgId, accessToken)
      .then((result) => {
        if (!cancelled) setBoards(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Board'lar yüklenemedi");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, accessToken]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    setPlanLimitHit(false);
    try {
      const board = await createBoard(orgId, accessToken, { name: name.trim() });
      setBoards((prev) => (prev ? [...prev, board] : [board]));
      setName("");
    } catch (err) {
      if (err instanceof ApiError) {
        // Backend PlanLimitExceededException'ı (bkz.
        // apps/api/src/billing/plan-limit.exception.ts) response body'sinin
        // `error` alanına bu sabit kodu koyuyor — generic bir hatadan
        // ayırt edip "Pro'ya yükselt" CTA'sını burada gösteriyoruz.
        setPlanLimitHit(err.code === "PLAN_LIMIT_EXCEEDED");
        setError(err.message);
      } else {
        setError("Board oluşturulamadı");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Board&apos;lar
      </h2>

      {boards === null ? (
        <p className="text-sm text-zinc-500">Yükleniyor…</p>
      ) : boards.length === 0 ? (
        <p className="text-sm text-zinc-500">Bu workspace&apos;te henüz board yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {boards.map((board) => (
            <li
              key={board.id}
              className="flex items-center justify-between rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10"
            >
              <span>{board.name}</span>
              <span className="text-xs text-zinc-500">
                {VISIBILITY_LABELS[board.visibility]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Yeni board adı"
            className="flex-1 rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="shrink-0 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {submitting ? "Oluşturuluyor…" : "Board oluştur"}
          </button>
        </form>
      )}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">
          <p>{error}</p>
          {planLimitHit && (
            <Link
              href={`/admin/${orgSlug}/billing`}
              className="underline hover:text-red-700 dark:hover:text-red-300"
            >
              Pro&apos;ya yükselt →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

const VISIBILITY_LABELS: Record<ApiBoard["visibility"], string> = {
  PUBLIC: "Herkese açık",
  PRIVATE: "Özel",
};
