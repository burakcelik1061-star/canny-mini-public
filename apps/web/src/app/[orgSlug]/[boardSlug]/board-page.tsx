"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  addVote,
  removeVote,
  ApiError,
  createPost,
  listBoardTags,
  listPublicPosts,
  POST_STATUSES,
  type ApiBoard,
  type ApiPost,
  type ApiTag,
  type PostSort,
  type PostStatus,
} from "@/lib/api";
import { clearAuth, useStoredAuth, type StoredAuth } from "@/lib/auth-storage";
import { NotificationBell } from "@/components/notification-bell";
import { AuthForms, STATUS_LABELS, VoteButton } from "./shared";

// Mevcut sort/status/search/tag'ı, verilen alan(lar)ı override ederek bir
// query string'e çevirir — SortTabs/StatusTabs/TagTabs/SearchForm'un hepsi
// "diğer filtreleri koruyup sadece kendi alanını değiştirme" davranışını
// buradan paylaşıyor (aksi halde ör. sıralamayı değiştirmek arama'yı
// sıfırlardı).
function buildHref(
  current: {
    sort: PostSort;
    status?: PostStatus;
    search?: string;
    tag?: string;
  },
  overrides: Partial<{
    sort: PostSort;
    status: PostStatus | undefined;
    search: string | undefined;
    tag: string | undefined;
  }>,
): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.sort === "top") {
    params.set("sort", "top");
  }
  if (merged.status) {
    params.set("status", merged.status);
  }
  if (merged.search) {
    params.set("search", merged.search);
  }
  if (merged.tag) {
    params.set("tag", merged.tag);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

export function BoardPage({
  orgSlug,
  boardSlug,
  board,
  initialPosts,
  sort,
  status,
  search,
  tag,
}: {
  orgSlug: string;
  boardSlug: string;
  board: ApiBoard;
  initialPosts: ApiPost[];
  sort: PostSort;
  status?: PostStatus;
  search?: string;
  tag?: string;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [tags, setTags] = useState<ApiTag[]>([]);
  const auth = useStoredAuth();

  useEffect(() => {
    let cancelled = false;
    listBoardTags(orgSlug, boardSlug)
      .then((result) => {
        if (!cancelled) setTags(result);
      })
      .catch(() => {
        // Tag filtre pill'leri yüklenemezse sessizce boş kalır — board'un
        // asıl işlevini (post listesi) engellemesin.
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, boardSlug]);

  // SSR sırasında (localStorage yok) hasVoted her zaman false gelir — giriş
  // yapmış bir kullanıcı sayfayı açtığında gerçek durumu göstermek için,
  // auth bilgisi tarayıcıda hazır olunca listeyi kendi token'ıyla bir kez
  // daha çekiyoruz. Bu, useStoredAuth'un aksine "harici bir sistemi (ağ)
  // state değişimine göre senkronize etmek" — klasik veri çekme efekti,
  // setState çağrısı da .then() içinde (efekt gövdesinde senkron değil).
  useEffect(() => {
    if (!auth) {
      return;
    }
    let cancelled = false;
    listPublicPosts(orgSlug, boardSlug, {
      sort,
      status,
      search,
      tag,
      accessToken: auth.accessToken,
    })
      .then((fresh) => {
        if (!cancelled) {
          setPosts(fresh);
        }
      })
      .catch(() => {
        // Sessizce yut — sayfa zaten SSR'dan gelen (hasVoted=false) veriyle
        // çalışır durumda, bu sadece bir iyileştirme denemesi.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auth referansı her render'da yeniden okunabiliyor, sadece token değişince tetiklensin istiyoruz
  }, [auth?.accessToken, orgSlug, boardSlug, sort, status, search, tag]);

  async function handleToggleVote(post: ApiPost) {
    if (!auth) {
      return;
    }
    const optimistic = post.hasVoted
      ? { hasVoted: false as const, voteCount: post.voteCount - 1 }
      : { hasVoted: true as const, voteCount: post.voteCount + 1 };
    setPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, ...optimistic } : p)),
    );
    try {
      const result = post.hasVoted
        ? await removeVote(orgSlug, boardSlug, post.id, auth.accessToken)
        : await addVote(orgSlug, boardSlug, post.id, auth.accessToken);
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, ...result } : p)),
      );
    } catch {
      // İstek başarısız oldu — optimistic güncellemeyi geri al.
      setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            {board.name}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {posts.length} öneri
          </p>
        </div>
        <NotificationBell />
      </header>

      <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
        {auth ? (
          <NewPostForm
            orgSlug={orgSlug}
            boardSlug={boardSlug}
            auth={auth}
            onCreated={(post) => setPosts((prev) => [post, ...prev])}
            onLogout={clearAuth}
          />
        ) : (
          <AuthForms prompt="Oy vermek/öneri eklemek için giriş yap." />
        )}
      </section>

      <FilterBar sort={sort} status={status} search={search} tag={tag} tags={tags} />
      <PostList
        orgSlug={orgSlug}
        boardSlug={boardSlug}
        posts={posts}
        canVote={auth !== null}
        onToggleVote={handleToggleVote}
      />
    </div>
  );
}

const tabClass = (active: boolean) =>
  `rounded-full px-3 py-1 text-sm whitespace-nowrap ${
    active
      ? "bg-foreground text-background"
      : "text-zinc-600 hover:bg-black/[.06] dark:text-zinc-400 dark:hover:bg-white/[.08]"
  }`;

function FilterBar({
  sort,
  status,
  search,
  tag,
  tags,
}: {
  sort: PostSort;
  status?: PostStatus;
  search?: string;
  tag?: string;
  tags: ApiTag[];
}) {
  const current = { sort, status, search, tag };

  return (
    <div className="flex flex-col gap-3">
      <nav className="flex gap-2">
        <Link
          href={buildHref(current, { sort: "new" })}
          className={tabClass(sort === "new")}
        >
          En yeni
        </Link>
        <Link
          href={buildHref(current, { sort: "top" })}
          className={tabClass(sort === "top")}
        >
          En çok oy
        </Link>
      </nav>

      <nav className="flex flex-wrap gap-2">
        <Link
          href={buildHref(current, { status: undefined })}
          className={tabClass(status === undefined)}
        >
          Tümü
        </Link>
        {POST_STATUSES.map((s) => (
          <Link
            key={s}
            href={buildHref(current, { status: s })}
            className={tabClass(status === s)}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>

      {tags.length > 0 && (
        <nav className="flex flex-wrap gap-2">
          <Link
            href={buildHref(current, { tag: undefined })}
            className={tabClass(tag === undefined)}
          >
            Tüm etiketler
          </Link>
          {tags.map((t) => (
            <Link
              key={t.id}
              href={buildHref(current, { tag: t.id })}
              className={tabClass(tag === t.id)}
            >
              {t.name}
            </Link>
          ))}
        </nav>
      )}

      <SearchForm current={current} />
    </div>
  );
}

function SearchForm({
  current,
}: {
  current: {
    sort: PostSort;
    status?: PostStatus;
    search?: string;
    tag?: string;
  };
}) {
  const router = useRouter();
  const [value, setValue] = useState(current.search ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    router.push(
      buildHref(current, { search: value.trim() || undefined }),
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="search"
        placeholder="Başlık/açıklamada ara…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-w-0 flex-1 rounded border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20"
      />
      <button
        type="submit"
        className="rounded-full border border-black/15 px-3 py-1 text-sm text-zinc-700 hover:bg-black/[.06] dark:border-white/20 dark:text-zinc-300 dark:hover:bg-white/[.08]"
      >
        Ara
      </button>
    </form>
  );
}

function PostList({
  orgSlug,
  boardSlug,
  posts,
  canVote,
  onToggleVote,
}: {
  orgSlug: string;
  boardSlug: string;
  posts: ApiPost[];
  canVote: boolean;
  onToggleVote: (post: ApiPost) => void;
}) {
  if (posts.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Henüz öneri yok — ilk öneriyi sen ekle.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {posts.map((post) => (
        <li
          key={post.id}
          className="flex gap-4 rounded-lg border border-black/10 p-4 dark:border-white/15"
        >
          <VoteButton
            voteCount={post.voteCount}
            hasVoted={post.hasVoted}
            canVote={canVote}
            onToggle={() => onToggleVote(post)}
          />
          <Link
            href={`/${orgSlug}/${boardSlug}/${post.id}`}
            className="min-w-0 flex-1"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-medium text-black hover:underline dark:text-zinc-50">
                {post.title}
              </h2>
              <span className="shrink-0 rounded-full bg-black/[.06] px-2 py-0.5 text-xs text-zinc-700 dark:bg-white/[.08] dark:text-zinc-300">
                {STATUS_LABELS[post.status]}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
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
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NewPostForm({
  orgSlug,
  boardSlug,
  auth,
  onCreated,
  onLogout,
}: {
  orgSlug: string;
  boardSlug: string;
  auth: StoredAuth;
  onCreated: (post: ApiPost) => void;
  onLogout: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const post = await createPost(orgSlug, boardSlug, auth.accessToken, {
        title,
        description,
      });
      onCreated(post);
      setTitle("");
      setDescription("");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Öneri eklenemedi",
      );
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
      <input
        type="text"
        required
        placeholder="Öneri başlığı"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      />
      <textarea
        required
        placeholder="Detaylar"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {submitting ? "Ekleniyor…" : "Öneri ekle"}
      </button>
    </form>
  );
}
