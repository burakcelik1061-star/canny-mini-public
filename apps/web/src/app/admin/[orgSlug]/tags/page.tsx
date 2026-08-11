"use client";

// Faz 3.3 — Tag yönetimi. Board CRUD/status yönetimindeki aynı ayrım:
// listeleme her org üyesine açık, oluşturma/silme OWNER|ADMIN'e kısıtlı
// (bkz. apps/api tags.controller.ts).

import { useEffect, useState, type FormEvent } from "react";
import { useAdminOrg } from "@/components/admin-shell";
import {
  ApiError,
  createTag,
  deleteTag,
  listOrgTags,
  type ApiTag,
} from "@/lib/api";

const DEFAULT_COLOR = "#71717a";

export default function AdminTagsPage() {
  const { org, accessToken } = useAdminOrg();
  const canEdit = org.role === "OWNER" || org.role === "ADMIN";

  const [tags, setTags] = useState<ApiTag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listOrgTags(org.id, accessToken)
      .then((result) => {
        if (!cancelled) setTags(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Tag'ler yüklenemedi");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [org.id, accessToken]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const tag = await createTag(org.id, accessToken, {
        name: name.trim(),
        color,
      });
      setTags((prev) => (prev ? [...prev, tag].sort(byName) : [tag]));
      setName("");
      setColor(DEFAULT_COLOR);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Tag oluşturulamadı");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(tagId: string) {
    setError(null);
    // İyimser silme — kanban'daki drag-drop'la aynı desen: hemen kaldır,
    // başarısız olursa geri ekle.
    const previous = tags;
    setTags((prev) => (prev ? prev.filter((t) => t.id !== tagId) : prev));
    try {
      await deleteTag(org.id, tagId, accessToken);
    } catch (err) {
      setTags(previous);
      setError(err instanceof ApiError ? err.message : "Tag silinemedi");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Etiketler</h1>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {canEdit && (
        <form onSubmit={handleCreate} className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="tag-name" className="text-xs text-zinc-500">
              İsim
            </label>
            <input
              id="tag-name"
              required
              minLength={1}
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ör. bug, ux, mobile"
              className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="tag-color" className="text-xs text-zinc-500">
              Renk
            </label>
            <input
              id="tag-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 rounded border border-black/15 bg-transparent dark:border-white/20"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {submitting ? "Ekleniyor…" : "Ekle"}
          </button>
        </form>
      )}

      {tags === null ? (
        <p className="text-sm text-zinc-500">Yükleniyor…</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-zinc-500">Henüz bir tag yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex items-center justify-between rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void handleDelete(tag.id)}
                  className="text-xs text-zinc-500 underline hover:text-red-600 dark:hover:text-red-400"
                >
                  Sil
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function byName(a: ApiTag, b: ApiTag): number {
  return a.name.localeCompare(b.name);
}
