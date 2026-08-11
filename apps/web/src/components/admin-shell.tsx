"use client";

// Faz 3.1 — Admin dashboard iskeleti: layout + sidebar navigasyon + org
// switcher. Tüm /admin altı sayfalar auth durumunu ve org üyeliğini
// merkezi olarak burada kontrol eder, sayfa bileşenleri tekrar auth/rol
// kontrolü yapmaz (public board sayfalarındaki auth deseni gibi:
// accessToken localStorage'da, bkz. lib/auth-storage.ts — bu yüzden
// koruma sunucu tarafında değil, burada istemci tarafında yapılıyor).
//
// apps/api tarafı zaten kendi güvenliğini sağlıyor (JwtAccessGuard +
// OrgMembershipGuard) — buradaki kontrol sadece UX için: üye olunmayan
// bir org'un verisi hiç istenmesin, kullanıcıya anlamlı bir mesaj
// gösterilsin.

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AuthForms } from "@/components/auth-forms";
import { NotificationBell } from "@/components/notification-bell";
import {
  ApiError,
  createOrganization,
  getMyOrganizations,
  type ApiOrganization,
} from "@/lib/api";
import { clearAuth, useStoredAuth } from "@/lib/auth-storage";

interface AdminOrgsContextValue {
  orgs: ApiOrganization[];
  currentOrg: ApiOrganization | null;
  accessToken: string;
}

const AdminOrgsContext = createContext<AdminOrgsContextValue | null>(null);

// [orgSlug] altındaki sayfalar (ör. app/admin/[orgSlug]/page.tsx) org'u ve
// accessToken'ı tekrar organizations listesini çekmeden buradan alır —
// AdminShell zaten üyelik kontrolünü yapıp children'ı sadece geçerli bir
// org için render ediyor, bu yüzden burada `currentOrg` hep dolu gelir.
export function useAdminOrg(): { org: ApiOrganization; accessToken: string } {
  const ctx = useContext(AdminOrgsContext);
  if (!ctx || !ctx.currentOrg) {
    throw new Error(
      "useAdminOrg sadece AdminShell'in bir org context'i çözdüğü sayfalarda kullanılabilir",
    );
  }
  return { org: ctx.currentOrg, accessToken: ctx.accessToken };
}

// `note` her öğede (opsiyonel de olsa) tanımlı tutuluyor — 4.3'ten sonra
// tüm öğeler enabled:true oldu ama gelecekte yeni bir Faz X.Y ile
// devre dışı bir öğe eklenirse (bkz. AdminNavLink'in `!item.enabled`
// dalı) union tipi kırılmasın diye.
const NAV_ITEMS = [
  { label: "Genel Bakış", suffix: "", enabled: true, note: undefined },
  { label: "Roadmap", suffix: "/roadmap", enabled: true, note: undefined },
  { label: "Etiketler", suffix: "/tags", enabled: true, note: undefined },
  { label: "Billing", suffix: "/billing", enabled: true, note: undefined },
  { label: "Ayarlar", suffix: "/settings", enabled: true, note: undefined },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const auth = useStoredAuth();

  if (auth === null) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-sm flex-col justify-center gap-4 px-6">
        <h1 className="text-lg font-semibold">Admin paneli</h1>
        <AuthForms prompt="Admin paneline erişmek için giriş yap." />
      </div>
    );
  }

  return <AuthenticatedAdminShell accessToken={auth.accessToken} userName={auth.user.name}>{children}</AuthenticatedAdminShell>;
}

function AuthenticatedAdminShell({
  accessToken,
  userName,
  children,
}: {
  accessToken: string;
  userName: string;
  children: ReactNode;
}) {
  const params = useParams<{ orgSlug?: string }>();
  const [orgs, setOrgs] = useState<ApiOrganization[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyOrganizations(accessToken)
      .then((result) => {
        if (!cancelled) setOrgs(result);
      })
      .catch((err) => {
        if (cancelled) return;
        // 401: accessToken (15dk) süresi dolmuş — refresh akışı henüz yok
        // (bkz. lib/auth-storage.ts), kullanıcıyı yeniden giriş yapmaya
        // yönlendirmek en doğrusu.
        if (err instanceof ApiError && err.status === 401) {
          clearAuth();
          return;
        }
        setError(err instanceof ApiError ? err.message : "Workspace'ler yüklenemedi");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const currentSlug = params?.orgSlug;
  const currentOrg = orgs?.find((org) => org.slug === currentSlug) ?? null;

  return (
    <div className="flex min-h-[calc(100vh-0px)] flex-1">
      <aside className="flex w-60 shrink-0 flex-col gap-6 border-r border-black/10 px-4 py-6 dark:border-white/10">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Giriş yapan
            </p>
            <p className="truncate text-sm font-medium">{userName}</p>
            <button
              type="button"
              onClick={clearAuth}
              className="mt-1 text-left text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Çıkış yap
            </button>
          </div>
          <NotificationBell />
        </div>

        <OrgSwitcher orgs={orgs} currentSlug={currentSlug} />

        {/* Faz 7.2 — bu form buraya kadar HİÇ YOKTU: POST /organizations
            1.3'ten beri var ama apps/web onu hiç çağırmıyordu, yani yeni
            kayıt olan bir kullanıcı "Henüz bir workspace'in yok."
            ekranında tıkanıyor ve uygulamayı hiç kullanamıyordu (E2E
            senaryosunu yazarken ortaya çıktı — "kayıt ol → board oluştur"
            akışının ilk adımı tarayıcıdan mümkün değildi). */}
        {orgs !== null && (
          <CreateOrgForm
            accessToken={accessToken}
            onCreated={(org) => setOrgs((prev) => [...(prev ?? []), org])}
          />
        )}

        {currentSlug && (
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <AdminNavLink key={item.label} orgSlug={currentSlug} item={item} />
            ))}
          </nav>
        )}
      </aside>

      <main className="flex-1 px-8 py-6">
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : orgs === null ? (
          <p className="text-sm text-zinc-500">Yükleniyor…</p>
        ) : currentSlug && !currentOrg ? (
          <p className="text-sm text-zinc-500">
            Bu workspace&apos;e üye değilsin ya da workspace bulunamadı.
          </p>
        ) : (
          <AdminOrgsContext.Provider value={{ orgs, currentOrg, accessToken }}>
            {children}
          </AdminOrgsContext.Provider>
        )}
      </main>
    </div>
  );
}

// Sidebar'daki org switcher: birden fazla workspace'i varsa (3.1'in
// kapsamı) aralarında geçiş — bir dropdown yerine düz bir liste, hem
// erişilebilirlik hem de mevcut org'u vurgulamak (aktif link stiliyle)
// için daha basit.
function OrgSwitcher({
  orgs,
  currentSlug,
}: {
  orgs: ApiOrganization[] | null;
  currentSlug: string | undefined;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-500">
        Workspace&apos;ler
      </p>
      {orgs === null ? (
        <p className="mt-1 text-sm text-zinc-500">Yükleniyor…</p>
      ) : orgs.length === 0 ? (
        <p className="mt-1 text-sm text-zinc-500">Henüz bir workspace&apos;in yok.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5">
          {orgs.map((org) => {
            const active = org.slug === currentSlug;
            return (
              <li key={org.id}>
                <Link
                  href={`/admin/${org.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={`block truncate rounded px-2 py-1 text-sm ${
                    active
                      ? "bg-foreground text-background"
                      : "text-zinc-700 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
                  }`}
                >
                  {org.name}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Workspace oluşturma — bilinçli olarak sidebar'da, ayrı bir onboarding
// sayfası değil: org switcher'ın hemen altında durunca "hiç workspace'i
// olmayan" ve "ikinci bir workspace açmak isteyen" kullanıcı aynı yeri
// kullanıyor, ayrıca AdminShell'in zaten elinde olan orgs state'ini
// doğrudan güncelleyebiliyor (yeniden fetch gerekmiyor).
function CreateOrgForm({
  accessToken,
  onCreated,
}: {
  accessToken: string;
  onCreated: (org: ApiOrganization) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const org = await createOrganization(accessToken, { name: trimmed });
      onCreated(org);
      setName("");
      // Slug'ı backend ürettiği için yönlendirmeyi ancak yanıt geldikten
      // sonra yapabiliyoruz (aynı isimde bir org varsa slug "-2" ile
      // biter, bkz. generateUniqueSlug).
      router.push(`/admin/${org.slug}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Workspace oluşturulamadı",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label
        htmlFor="new-org-name"
        className="text-xs uppercase tracking-wide text-zinc-500"
      >
        Yeni workspace
      </label>
      <input
        id="new-org-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Workspace adı"
        className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
      />
      <button
        type="submit"
        disabled={submitting || !name.trim()}
        className="rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {submitting ? "Oluşturuluyor…" : "Workspace oluştur"}
      </button>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </form>
  );
}

function AdminNavLink({
  orgSlug,
  item,
}: {
  orgSlug: string;
  item: (typeof NAV_ITEMS)[number];
}) {
  const pathname = usePathname();
  const href = `/admin/${orgSlug}${item.suffix}`;
  const active = pathname === href;

  if (!item.enabled) {
    return (
      <span
        title={`${item.note} tamamlanınca aktif olacak`}
        className="flex items-center justify-between rounded px-2 py-1 text-sm text-zinc-400 dark:text-zinc-600"
      >
        {item.label}
        <span className="text-xs">{item.note}</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded px-2 py-1 text-sm ${
        active
          ? "bg-black/5 font-medium dark:bg-white/10"
          : "text-zinc-700 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
      }`}
    >
      {item.label}
    </Link>
  );
}
