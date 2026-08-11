import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addVote,
  removeVote,
  ApiError,
  createPost,
  getPublicBoard,
  listPublicPosts,
  login,
  register,
  STATUS_LABELS,
  type ApiBoard,
  type ApiPost,
  type PostSort,
} from "./lib/api";
import { clearAuth, saveAuth, useStoredAuth, type StoredAuth } from "./lib/auth-storage";
import { readTarget } from "./lib/target";
import { useBranding } from "./lib/use-branding";
import { useEmbedSync } from "./lib/use-embed-sync";
import { useWidgetIdentify } from "./lib/use-widget-identify";

// Board'u gömen sayfa hangi org/board'u göstereceğini query string ile
// söyler — `<iframe src=".../?org=acme&board=feedback">`. Bu embed
// script'inin (embed/embed.ts, 4.2) ürettiği iframe src'nin şekli. Bir
// route kütüphanesi (react-router vb.) eklemedik — tek "sayfa"lık bir
// widget'ın tek ihtiyacı bu, "minimal bundle" hedefiyle çelişirdi.
// (readTarget'ın kendisi lib/target.ts'te — bkz. oradaki yorum.)

export function App() {
  // rootRef, App'in TÜM durumlarını (yükleniyor/hata/yüklü) sarmalıyor —
  // useEmbedSync'in ResizeObserver'ı hangi state'te olursa olsun gerçek
  // içerik yüksekliğini host'a bildirebilsin diye (bkz. use-embed-sync.ts).
  const rootRef = useRef<HTMLDivElement>(null);
  useEmbedSync(rootRef);
  const target = readTarget();

  return (
    <div ref={rootRef}>
      {!target ? (
        <div className="cm-widget cm-widget--message">
          <p>
            Widget yanlış yapılandırılmış: <code>?org=&lt;orgSlug&gt;</code>{" "}
            ve <code>&amp;board=&lt;boardSlug&gt;</code> query parametreleri
            gerekiyor.
          </p>
        </div>
      ) : (
        <BoardWidget orgSlug={target.org} boardSlug={target.board} />
      )}
    </div>
  );
}

function BoardWidget({
  orgSlug,
  boardSlug,
}: {
  orgSlug: string;
  boardSlug: string;
}) {
  const [board, setBoard] = useState<ApiBoard | null | undefined>(undefined); // undefined = yükleniyor
  const [posts, setPosts] = useState<ApiPost[]>([]);
  const [sort, setSort] = useState<PostSort>("new");
  const [error, setError] = useState<string | null>(null);
  const auth = useStoredAuth();
  const branding = useBranding(orgSlug);
  const identifyStatus = useWidgetIdentify(orgSlug, auth);

  useEffect(() => {
    let cancelled = false;
    getPublicBoard(orgSlug, boardSlug)
      .then((result) => {
        if (!cancelled) setBoard(result);
      })
      .catch(() => {
        if (!cancelled) setBoard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, boardSlug]);

  useEffect(() => {
    if (board === undefined || board === null) {
      return;
    }
    let cancelled = false;
    listPublicPosts(orgSlug, boardSlug, {
      sort,
      accessToken: auth?.accessToken,
    })
      .then((result) => {
        if (!cancelled) setPosts(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Liste yüklenemedi");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, boardSlug, sort, board, auth?.accessToken]);

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
      setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
    }
  }

  if (board === undefined) {
    return (
      <div className="cm-widget cm-widget--message">
        <p>Yükleniyor…</p>
      </div>
    );
  }

  if (board === null) {
    return (
      <div className="cm-widget cm-widget--message">
        <p>Board bulunamadı: {orgSlug}/{boardSlug}</p>
      </div>
    );
  }

  return (
    <div className="cm-widget">
      <header className="cm-header">
        {branding?.logoUrl && (
          <img src={branding.logoUrl} alt="" className="cm-logo" />
        )}
        <div>
          <h1>{board.name}</h1>
          <p>{posts.length} öneri</p>
        </div>
      </header>

      <section className="cm-panel">
        {auth ? (
          <NewPostForm
            orgSlug={orgSlug}
            boardSlug={boardSlug}
            auth={auth}
            onCreated={(post) => setPosts((prev) => [post, ...prev])}
            onLogout={clearAuth}
          />
        ) : identifyStatus === "pending" ? (
          <p className="cm-muted">Kimlik doğrulanıyor…</p>
        ) : (
          <AuthForms />
        )}
      </section>

      {error && <p className="cm-error">{error}</p>}

      <nav className="cm-tabs">
        <button
          type="button"
          className={sort === "new" ? "cm-tab cm-tab--active" : "cm-tab"}
          onClick={() => setSort("new")}
        >
          En yeni
        </button>
        <button
          type="button"
          className={sort === "top" ? "cm-tab cm-tab--active" : "cm-tab"}
          onClick={() => setSort("top")}
        >
          En çok oy
        </button>
      </nav>

      <PostList posts={posts} canVote={auth !== null} onToggleVote={handleToggleVote} />
    </div>
  );
}

function PostList({
  posts,
  canVote,
  onToggleVote,
}: {
  posts: ApiPost[];
  canVote: boolean;
  onToggleVote: (post: ApiPost) => void;
}) {
  if (posts.length === 0) {
    return <p className="cm-empty">Henüz öneri yok — ilk öneriyi sen ekle.</p>;
  }

  return (
    <ul className="cm-post-list">
      {posts.map((post) => (
        <li key={post.id} className="cm-post">
          <button
            type="button"
            disabled={!canVote}
            aria-pressed={post.hasVoted}
            title={canVote ? undefined : "Oy vermek için giriş yap"}
            className={
              post.hasVoted ? "cm-vote cm-vote--active" : "cm-vote"
            }
            onClick={() => onToggleVote(post)}
          >
            <span aria-hidden>▲</span>
            <span>{post.voteCount}</span>
          </button>
          <div className="cm-post-body">
            <div className="cm-post-title-row">
              <h2>{post.title}</h2>
              <span className="cm-status">{STATUS_LABELS[post.status]}</span>
            </div>
            <p>{post.description}</p>
          </div>
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
      setError(err instanceof ApiError ? err.message : "Öneri eklenemedi");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="cm-form">
      <div className="cm-form-row">
        <p className="cm-muted">{auth.user.name} olarak giriş yapıldı</p>
        <button type="button" className="cm-link" onClick={onLogout}>
          Çıkış yap
        </button>
      </div>
      <input
        type="text"
        required
        placeholder="Öneri başlığı"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        required
        placeholder="Detaylar"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {error && <p className="cm-error">{error}</p>}
      <button type="submit" disabled={submitting} className="cm-button">
        {submitting ? "Ekleniyor…" : "Öneri ekle"}
      </button>
    </form>
  );
}

// apps/web'deki AuthForms'un (components/auth-forms.tsx) minimal bir
// karşılığı — widget'ın apps/web'e bağımlılığı olmadığı için kopyalandı
// (bkz. lib/api.ts'in başındaki yorum). Kimlik federasyonu (gömen sitenin
// kendi kullanıcısını aktarması) 4.3'te bu formun yerini alabilir/
// tamamlayabilir.
function AuthForms() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await login(email, password)
          : await register(email, password, name);
      saveAuth(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : mode === "login"
            ? "Giriş yapılamadı"
            : "Kayıt olunamadı",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="cm-form">
      <p className="cm-muted">Oy vermek/öneri eklemek için giriş yap.</p>
      {mode === "register" && (
        <input
          type="text"
          required
          placeholder="İsim"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <input
        type="email"
        required
        placeholder="E-posta"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        required
        placeholder="Şifre"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="cm-error">{error}</p>}
      <button type="submit" disabled={submitting} className="cm-button">
        {submitting
          ? "Gönderiliyor…"
          : mode === "login"
            ? "Giriş yap"
            : "Kayıt ol"}
      </button>
      <button
        type="button"
        className="cm-link"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "Hesabın yok mu? Kayıt ol" : "Zaten hesabın var mı? Giriş yap"}
      </button>
    </form>
  );
}
