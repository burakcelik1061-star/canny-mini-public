"use client";

// Faz 3.2 — Roadmap kanban sayfası. Org'un birden fazla board'u olabilir
// (2.1) — kanban tek bir board'a ait olduğu için burada önce hangi
// board'un roadmap'inin gösterileceği seçiliyor ([orgSlug]/page.tsx'teki
// salt-okunur board listesiyle aynı GET /organizations/:orgId/boards
// çağrısı, sadece burada seçilebilir).

import { useEffect, useState } from "react";
import { useAdminOrg } from "@/components/admin-shell";
import { KanbanBoard } from "@/components/kanban-board";
import { ApiError, listOrgBoards, type ApiBoard } from "@/lib/api";

export default function AdminRoadmapPage() {
  const { org, accessToken } = useAdminOrg();
  const [boards, setBoards] = useState<ApiBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOrgBoards(org.id, accessToken)
      .then((result) => {
        if (cancelled) return;
        setBoards(result);
        // Varsayılan: ilk board. Kullanıcı elle değiştirebilir (aşağıdaki
        // select) — org tek board'luysa zaten seçici gösterilmiyor.
        setSelectedBoardId((current) => current ?? result[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Board'lar yüklenemedi");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [org.id, accessToken]);

  const canEdit = org.role === "OWNER" || org.role === "ADMIN";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Roadmap</h1>
        {boards && boards.length > 1 && (
          <select
            value={selectedBoardId ?? ""}
            onChange={(e) => setSelectedBoardId(e.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
          >
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!canEdit && (
        <p className="text-xs text-zinc-500">
          Kartları sadece Owner/Admin taşıyabilir — sen {org.role} rolündesin,
          salt-okunur görüntülüyorsun.
        </p>
      )}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : boards === null ? (
        <p className="text-sm text-zinc-500">Yükleniyor…</p>
      ) : boards.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Bu workspace&apos;te henüz board yok, önce bir board oluşturulmalı.
        </p>
      ) : selectedBoardId ? (
        // key: board değişince KanbanBoard'un kendi post/drag state'i
        // sıfırdan kurulsun diye bilinçli remount — [orgSlug]/[boardSlug]/
        // page.tsx'teki sort/status/search remount deseniyle aynı yaklaşım.
        <KanbanBoard
          key={selectedBoardId}
          orgId={org.id}
          boardId={selectedBoardId}
          accessToken={accessToken}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}
