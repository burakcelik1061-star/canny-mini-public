"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  addVote,
  removeVote,
  ApiError,
  createComment,
  getPost,
  type ApiBoard,
  type ApiComment,
  type ApiPost,
} from "@/lib/api";
import { clearAuth, useStoredAuth, type StoredAuth } from "@/lib/auth-storage";
import { NotificationBell } from "@/components/notification-bell";
import { AuthForms, STATUS_LABELS, VoteButton } from "../shared";

export function PostDetail({
  orgSlug,
  boardSlug,
  board,
  initialPost,
  initialComments,
}: {
  orgSlug: string;
  boardSlug: string;
  board: ApiBoard;
  initialPost: ApiPost;
  initialComments: ApiComment[];
}) {
  const [post, setPost] = useState(initialPost);
  const [comments, setComments] = useState(initialComments);
  const auth = useStoredAuth();

  // board-page.tsx'teki aynı desen: SSR hasVoted'ı bilemez, auth
  // localStorage'dan yüklenince post'u kendi token'ıyla bir kez daha çekiyoruz.
  useEffect(() => {
    if (!auth) {
      return;
    }
    let cancelled = false;
    getPost(orgSlug, boardSlug, post.id, { accessToken: auth.accessToken })
      .then((fresh) => {
        if (fresh && !cancelled) {
          setPost(fresh);
        }
      })
      .catch(() => {
        // Sessizce yut — SSR'dan gelen veriyle çalışmaya devam eder.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sadece token değişince tetiklensin istiyoruz
  }, [auth?.accessToken, orgSlug, boardSlug, post.id]);

  async function handleToggleVote() {
    if (!auth) {
      return;
    }
    const optimistic = post.hasVoted
      ? { hasVoted: false as const, voteCount: post.voteCount - 1 }
      : { hasVoted: true as const, voteCount: post.voteCount + 1 };
    setPost((prev) => ({ ...prev, ...optimistic }));
    try {
      const result = post.hasVoted
        ? await removeVote(orgSlug, boardSlug, post.id, auth.accessToken)
        : await addVote(orgSlug, boardSlug, post.id, auth.accessToken);
      setPost((prev) => ({ ...prev, ...result }));
    } catch {
      setPost(post);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/${orgSlug}/${boardSlug}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← {board.name}
        </Link>
        <NotificationBell />
      </div>

      <div className="flex gap-4">
        <VoteButton
          voteCount={post.voteCount}
          hasVoted={post.hasVoted}
          canVote={auth !== null}
          onToggle={handleToggleVote}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
              {post.title}
            </h1>
            <span className="shrink-0 rounded-full bg-black/[.06] px-2 py-0.5 text-xs text-zinc-700 dark:bg-white/[.08] dark:text-zinc-300">
              {STATUS_LABELS[post.status]}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
            {post.description}
          </p>
          {post.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {post.tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-full px-2 py-0.5 text-xs text-white"
                  style={{ backgroundColor: t.color }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {comments.length} yorum
        </h2>

        <div className="rounded-lg border border-black/10 p-5 dark:border-white/15">
          {auth ? (
            <CommentForm
              orgSlug={orgSlug}
              boardSlug={boardSlug}
              postId={post.id}
              auth={auth}
              onCreated={(comment) =>
                setComments((prev) => [...prev, comment])
              }
              onLogout={clearAuth}
            />
          ) : (
            <AuthForms prompt="Yorum yapmak/oy vermek için giriş yap." />
          )}
        </div>

        <CommentList comments={comments} />
      </section>
    </div>
  );
}

function CommentList({ comments }: { comments: ApiComment[] }) {
  if (comments.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Henüz yorum yok — ilk yorumu sen yaz.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {comments.map((comment) => (
        <li
          key={comment.id}
          className="rounded-lg border border-black/10 p-4 dark:border-white/15"
        >
          {comment.isOfficial && (
            <span className="mb-1 inline-block rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background">
              Resmi yanıt
            </span>
          )}
          <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {comment.body}
          </p>
        </li>
      ))}
    </ul>
  );
}

function CommentForm({
  orgSlug,
  boardSlug,
  postId,
  auth,
  onCreated,
  onLogout,
}: {
  orgSlug: string;
  boardSlug: string;
  postId: string;
  auth: StoredAuth;
  onCreated: (comment: ApiComment) => void;
  onLogout: () => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const comment = await createComment(
        orgSlug,
        boardSlug,
        postId,
        auth.accessToken,
        body,
      );
      onCreated(comment);
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Yorum eklenemedi");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {auth.user.name} olarak giriş yapıldı
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Çıkış yap
        </button>
      </div>
      <textarea
        required
        placeholder="Yorumun"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {submitting ? "Ekleniyor…" : "Yorum ekle"}
      </button>
    </form>
  );
}
