"use client";

// Faz 3.2 — Roadmap kanban: post'ları sürükle-bırak ile status'ler arasında
// taşıma. Bağımlılık eklemeden native HTML5 drag-and-drop
// API'si kullanılıyor — bu ölçekte (4 kolon, tek board) bir dnd
// kütüphanesi gereksiz karmaşıklık olurdu.
//
// Faz 3.3: her karta iki ek aksiyon eklendi — etiketleme (inline
// checkbox paneli) ve duplicate merge (inline post seçici). Ayrı bir
// modal/popover kütüphanesi yerine kartın altında açılan bir panel —
// aynı "minimal bağımlılık" gerekçesi. Faz 3.4: aynı desende üçüncü bir
// panel — admin yanıtı (resmi yorum).

import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  createOfficialComment,
  listOrgBoardPosts,
  listOrgTags,
  mergePost,
  STATUS_LABELS,
  updatePostStatus,
  updatePostTags,
  type ApiPost,
  type ApiTag,
  type PostStatus,
} from "@/lib/api";

// CLOSED kanban'da bir kolon değil — prompt-library'nin 3.2 tanımı da
// (Under Review / Planned / In Progress / Complete) sadece bu 4'ünü
// istiyor. Kapatılmış post'lar listOrgBoardPosts'tan yine de dönüyor
// (admin-posts.controller.ts filtre uygulamıyor) ama burada gösterilmiyor.
const KANBAN_STATUSES: readonly PostStatus[] = [
  "UNDER_REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETE",
];

type OpenPanel = { postId: string; type: "tags" | "merge" | "reply" } | null;

export function KanbanBoard({
  orgId,
  boardId,
  accessToken,
  canEdit,
}: {
  orgId: string;
  boardId: string;
  accessToken: string;
  // OWNER|ADMIN kartları taşıyabilir/etiketleyebilir/birleştirebilir
  // (apps/api'de @OrgRoles('OWNER','ADMIN') ile aynı sınır) — MEMBER
  // kanban'ı görebilir ama bu aksiyonlar hiç gösterilmiyor.
  canEdit: boolean;
}) {
  const [posts, setPosts] = useState<ApiPost[] | null>(null);
  const [tags, setTags] = useState<ApiTag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOrgBoardPosts(orgId, boardId, accessToken)
      .then((result) => {
        if (!cancelled) setPosts(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Post'lar yüklenemedi");
        }
      });
    // Tag listesi sadece canEdit'te lazım (etiketleme paneli) — MEMBER için
    // gereksiz bir istek.
    if (canEdit) {
      listOrgTags(orgId, accessToken)
        .then((result) => {
          if (!cancelled) setTags(result);
        })
        .catch(() => {
          // Tag listesi yüklenemezse etiketleme paneli boş görünür —
          // kanban'ın asıl işlevini (status taşıma) engellemesin diye
          // sessizce yutuluyor, ayrı bir error state'e gerek yok.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [orgId, boardId, accessToken, canEdit]);

  async function handleDrop(newStatus: PostStatus, postId: string) {
    if (!canEdit || !posts) return;
    const post = posts.find((p) => p.id === postId);
    if (!post || post.status === newStatus) return;

    const previousStatus = post.status;
    // İyimser güncelleme: kart hemen yeni kolona taşınır, istek arka planda
    // gider. Başarısız olursa geri alınır (bkz. catch) — sürükle-bırak'ta
    // "isteği bekle, sonra taşı" UI'ı yavaş/kekeme hissettirirdi.
    setPosts((prev) =>
      prev
        ? prev.map((p) => (p.id === postId ? { ...p, status: newStatus } : p))
        : prev,
    );
    setError(null);

    try {
      await updatePostStatus(orgId, boardId, postId, newStatus, accessToken);
    } catch (err) {
      setPosts((prev) =>
        prev
          ? prev.map((p) =>
              p.id === postId ? { ...p, status: previousStatus } : p,
            )
          : prev,
      );
      setError(
        err instanceof ApiError ? err.message : "Status güncellenemedi",
      );
    }
  }

  async function handleToggleTag(post: ApiPost, tag: ApiTag) {
    const hasTag = post.tags.some((t) => t.id === tag.id);
    const newTagIds = hasTag
      ? post.tags.filter((t) => t.id !== tag.id).map((t) => t.id)
      : [...post.tags.map((t) => t.id), tag.id];

    const previousTags = post.tags;
    setPosts((prev) =>
      prev
        ? prev.map((p) =>
            p.id === post.id
              ? {
                  ...p,
                  tags: hasTag
                    ? p.tags.filter((t) => t.id !== tag.id)
                    : [...p.tags, tag],
                }
              : p,
          )
        : prev,
    );
    setActionError(null);

    try {
      await updatePostTags(orgId, boardId, post.id, newTagIds, accessToken);
    } catch (err) {
      setPosts((prev) =>
        prev
          ? prev.map((p) => (p.id === post.id ? { ...p, tags: previousTags } : p))
          : prev,
      );
      setActionError(
        err instanceof ApiError ? err.message : "Tag güncellenemedi",
      );
    }
  }

  async function handleMerge(sourcePostId: string, targetPostId: string) {
    setActionError(null);
    try {
      await mergePost(orgId, boardId, sourcePostId, targetPostId, accessToken);
      // Merge edilen post artık hiçbir listede görünmez (bkz. apps/api
      // PostsService.listPostsForBoard'un mergedIntoPostId filtresi) —
      // kartı doğrudan kaldırıyoruz, yeniden fetch etmeye gerek yok.
      setPosts((prev) => (prev ? prev.filter((p) => p.id !== sourcePostId) : prev));
      setOpenPanel(null);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Post'lar birleştirilemedi",
      );
    }
  }

  // Admin yanıtı (3.4): merge/tag'in aksine post'un kanban'da gösterilen
  // hiçbir alanını değiştirmiyor (yorum, post'un kendisi değil) — sadece
  // isteği gönderip paneli kapatıyoruz, local state'te güncellenecek bir
  // şey yok. Başarı/hata ReplyPanel'in kendi state'inde gösteriliyor.
  async function handleReply(postId: string, body: string) {
    await createOfficialComment(orgId, boardId, postId, body, accessToken);
    setOpenPanel(null);
  }

  if (error && posts === null) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (posts === null) {
    return <p className="text-sm text-zinc-500">Yükleniyor…</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {(error || actionError) && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error ?? actionError}
        </p>
      )}
      <div className="flex gap-4 overflow-x-auto">
        {KANBAN_STATUSES.map((status) => {
          const columnPosts = posts.filter((post) => post.status === status);
          return (
            <div
              key={status}
              onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
              onDrop={
                canEdit
                  ? (e) => {
                      e.preventDefault();
                      const postId = e.dataTransfer.getData("text/plain");
                      void handleDrop(status, postId);
                    }
                  : undefined
              }
              className="flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-black/[.03] p-3 dark:bg-white/[.04]"
            >
              <h3 className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-zinc-500">
                {STATUS_LABELS[status]}
                <span>{columnPosts.length}</span>
              </h3>
              <div className="flex min-h-16 flex-col gap-2">
                {columnPosts.map((post) => (
                  <article
                    key={post.id}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", post.id);
                      setDraggingId(post.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    className={`rounded border border-black/10 bg-white px-3 py-2 text-sm shadow-sm dark:border-white/10 dark:bg-zinc-900 ${
                      canEdit ? "cursor-grab active:cursor-grabbing" : ""
                    } ${draggingId === post.id ? "opacity-40" : ""}`}
                  >
                    <p className="font-medium">{post.title}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      ▲ {post.voteCount}
                    </p>
                    {post.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {post.tags.map((tag) => (
                          <span
                            key={tag.id}
                            className="rounded-full px-2 py-0.5 text-[10px] text-white"
                            style={{ backgroundColor: tag.color }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {canEdit && (
                      <div className="mt-2 flex gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenPanel((prev) =>
                              prev?.postId === post.id && prev.type === "tags"
                                ? null
                                : { postId: post.id, type: "tags" },
                            )
                          }
                          className="text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                        >
                          Etiketler
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setOpenPanel((prev) =>
                              prev?.postId === post.id && prev.type === "merge"
                                ? null
                                : { postId: post.id, type: "merge" },
                            )
                          }
                          className="text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                        >
                          Birleştir
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setOpenPanel((prev) =>
                              prev?.postId === post.id && prev.type === "reply"
                                ? null
                                : { postId: post.id, type: "reply" },
                            )
                          }
                          className="text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                        >
                          Yanıtla
                        </button>
                      </div>
                    )}

                    {canEdit &&
                      openPanel?.postId === post.id &&
                      openPanel.type === "tags" && (
                        <div className="mt-2 flex flex-col gap-1 border-t border-black/10 pt-2 dark:border-white/10">
                          {tags.length === 0 ? (
                            <p className="text-[11px] text-zinc-500">
                              Henüz tag yok.
                            </p>
                          ) : (
                            tags.map((tag) => (
                              <label
                                key={tag.id}
                                className="flex items-center gap-2 text-[11px]"
                              >
                                <input
                                  type="checkbox"
                                  checked={post.tags.some((t) => t.id === tag.id)}
                                  onChange={() => void handleToggleTag(post, tag)}
                                />
                                {tag.name}
                              </label>
                            ))
                          )}
                        </div>
                      )}

                    {canEdit &&
                      openPanel?.postId === post.id &&
                      openPanel.type === "merge" && (
                        <MergePanel
                          post={post}
                          candidates={posts.filter((p) => p.id !== post.id)}
                          onMerge={(targetId) => void handleMerge(post.id, targetId)}
                        />
                      )}

                    {canEdit &&
                      openPanel?.postId === post.id &&
                      openPanel.type === "reply" && (
                        <ReplyPanel
                          onSubmit={(body) => handleReply(post.id, body)}
                        />
                      )}
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MergePanel({
  post,
  candidates,
  onMerge,
}: {
  post: ApiPost;
  candidates: ApiPost[];
  onMerge: (targetPostId: string) => void;
}) {
  const [targetId, setTargetId] = useState("");

  if (candidates.length === 0) {
    return (
      <p className="mt-2 border-t border-black/10 pt-2 text-[11px] text-zinc-500 dark:border-white/10">
        Birleştirilecek başka post yok.
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-black/10 pt-2 dark:border-white/10">
      <select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        className="rounded border border-black/15 bg-transparent px-1 py-1 text-[11px] dark:border-white/20"
      >
        <option value="">Hedef post seç…</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!targetId}
        onClick={() => onMerge(targetId)}
        className="rounded bg-foreground px-2 py-1 text-[11px] font-medium text-background disabled:opacity-50"
      >
        &quot;{post.title}&quot;u seçilen post&apos;a birleştir
      </button>
    </div>
  );
}

function ReplyPanel({ onSubmit }: { onSubmit: (body: string) => Promise<void> }) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(body);
      // Başarılı olursa panel zaten kapatılıyor (bkz. handleReply) — burada
      // ekstra bir "gönderildi" state'i tutmaya gerek yok, unmount oluyor.
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Yanıt gönderilemedi",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 flex flex-col gap-1 border-t border-black/10 pt-2 dark:border-white/10"
    >
      <textarea
        required
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Resmi yanıt yaz…"
        className="rounded border border-black/15 bg-transparent px-2 py-1 text-[11px] dark:border-white/20"
      />
      {error && (
        <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded bg-foreground px-2 py-1 text-[11px] font-medium text-background disabled:opacity-50"
      >
        {submitting ? "Gönderiliyor…" : "Resmi yanıt olarak gönder"}
      </button>
    </form>
  );
}
