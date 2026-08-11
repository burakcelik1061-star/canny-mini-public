// apps/api'ye giden ince bir fetch sarmalayıcısı. apps/api/src'deki DTO'lar
// gibi packages/shared'daki tipler burada bilinçli olarak kullanılmıyor:
// gerçek HTTP JSON'ı Prisma'nın UPPER_CASE enum'larını ve ISO string
// tarihlerini döner, shared paket ise lowercase enum varsayıyor — aynı
// casing uyuşmazlığı apps/api/src/organizations/organizations.service.ts'in
// üstündeki yorumda da açıklanıyor.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

// Faz 4.3 — Ayarlar sayfasındaki embed kod örneğinin `src`'i için (bkz.
// apps/widget/vite.config.ts'in dev portu). Sadece kopyalanacak metni
// etkiler, apps/web bu URL'e hiç istek atmıyor.
export const WIDGET_URL =
  process.env.NEXT_PUBLIC_WIDGET_URL ?? "http://localhost:5173";

export type BoardVisibility = "PUBLIC" | "PRIVATE";

export interface ApiBoard {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  visibility: BoardVisibility;
  createdAt: string;
}

export type PostStatus =
  | "UNDER_REVIEW"
  | "PLANNED"
  | "IN_PROGRESS"
  | "COMPLETE"
  | "CLOSED";

export interface ApiTag {
  id: string;
  orgId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface ApiPost {
  id: string;
  boardId: string;
  title: string;
  description: string;
  status: PostStatus;
  voteCount: number;
  hasVoted: boolean;
  mergedIntoPostId: string | null;
  tags: ApiTag[];
  createdAt: string;
}

export type PostSort = "new" | "top";

// apps/api/src/posts/posts.service.ts'teki POST_STATUSES ile aynı liste —
// URL'den gelen ham bir status query param'ının geçerli olup olmadığını
// (?status=...) kontrol etmek için burada da tekilleştirilmiş.
export const POST_STATUSES: readonly PostStatus[] = [
  "UNDER_REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETE",
  "CLOSED",
];

export function isPostStatus(value: unknown): value is PostStatus {
  return (
    typeof value === "string" &&
    (POST_STATUSES as readonly string[]).includes(value)
  );
}

// Başlangıçta [orgSlug]/[boardSlug]/shared.tsx'e özeldi (2.2); admin
// panelinin roadmap kanban'ı (3.2) da aynı etikete ihtiyaç duyunca, tıpkı
// AuthForms'un @/components/auth-forms.tsx'e taşınması gibi, PostStatus'ün
// zaten tanımlı olduğu buraya taşındı. shared.tsx geriye dönük uyumluluk
// için re-export ediyor.
export const STATUS_LABELS: Record<PostStatus, string> = {
  UNDER_REVIEW: "İnceleniyor",
  PLANNED: "Planlandı",
  IN_PROGRESS: "Geliştiriliyor",
  COMPLETE: "Tamamlandı",
  CLOSED: "Kapatıldı",
};

export interface ApiComment {
  id: string;
  postId: string;
  body: string;
  isOfficial: boolean;
  createdAt: string;
}

export interface ApiUser {
  id: string;
  email: string;
  name: string;
}

export type OrgRole = "OWNER" | "ADMIN" | "MEMBER";

// Faz 6.1 — bkz. apps/api/prisma/schema.prisma Plan enum'u.
export type OrgPlan = "FREE" | "PRO";

export interface ApiOrganization {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
  plan: OrgPlan;
  createdAt: string;
}

// Faz 6.2 — `code` opsiyonel: apps/api'nin PlanLimitExceededException'ı
// (bkz. apps/api/src/billing/plan-limit.exception.ts) response body'sinin
// `error` alanına `PLAN_LIMIT_EXCEEDED` koyuyor, buraya taşınıyor ki
// çağıran taraf generic bir hatayla "limit aşıldı, Pro'ya yükselt" CTA'sı
// göstermesi gereken durumu ayırt edebilsin. Diğer tüm hatalarda `code`
// undefined kalır — sadece mesaj gösterilir (mevcut davranış).
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parseErrorBody(
  res: Response,
): Promise<{ message: string; code?: string }> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const message =
        "message" in body && typeof body.message === "string"
          ? body.message
          : `İstek başarısız oldu (${res.status})`;
      const code =
        "error" in body && typeof body.error === "string"
          ? body.error
          : undefined;
      return { message, code };
    }
  } catch {
    // JSON olmayan/boş bir gövde — jenerik mesaja düş.
  }
  return { message: `İstek başarısız oldu (${res.status})` };
}

// Faz 6.2'den önceki 28 çağrı sitesi sadece mesaja ihtiyaç duyuyor — hepsini
// `parseErrorBody`'ye taşımak yerine ince bir geriye-uyumlu sarmalayıcı.
async function parseErrorMessage(res: Response): Promise<string> {
  return (await parseErrorBody(res)).message;
}

// Sunucu bileşenlerinden SSR sırasında, istemci bileşenlerinden de
// (login/post formu) çağrılıyor — ikisinde de düz fetch yeterli, cookie/
// header gerektiren bir Next.js API'sine ihtiyaç yok.
export async function getPublicBoard(
  orgSlug: string,
  boardSlug: string,
): Promise<ApiBoard | null> {
  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}`,
    { cache: "no-store" },
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiBoard>;
}

export async function listPublicPosts(
  orgSlug: string,
  boardSlug: string,
  options?: {
    sort?: PostSort;
    status?: PostStatus;
    search?: string;
    tag?: string;
    accessToken?: string;
  },
): Promise<ApiPost[]> {
  const params = new URLSearchParams();
  if (options?.sort === "top") {
    params.set("sort", "top");
  }
  if (options?.status) {
    params.set("status", options.status);
  }
  if (options?.search) {
    params.set("search", options.search);
  }
  if (options?.tag) {
    params.set("tag", options.tag);
  }
  const query = params.toString() ? `?${params.toString()}` : "";

  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}/posts${query}`,
    {
      cache: "no-store",
      // accessToken verilirse apps/api tarafı (OptionalJwtAccessGuard)
      // hasVoted'ı bu kullanıcıya göre hesaplar — verilmezse hepsi false
      // döner, route yine de auth gerektirmeden çalışır.
      headers: options?.accessToken
        ? { Authorization: `Bearer ${options.accessToken}` }
        : undefined,
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiPost[]>;
}

// Board sayfasındaki tag filtresi (3.3) için — status pill'lerinin tag
// karşılığı. Auth gerektirmez (org'un tüm tag'leri, GET /public/.../tags).
export async function listBoardTags(
  orgSlug: string,
  boardSlug: string,
): Promise<ApiTag[]> {
  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}/tags`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiTag[]>;
}

export async function addVote(
  orgSlug: string,
  boardSlug: string,
  postId: string,
  accessToken: string,
): Promise<{ voteCount: number; hasVoted: true }> {
  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}/posts/${postId}/votes`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ voteCount: number; hasVoted: true }>;
}

export async function removeVote(
  orgSlug: string,
  boardSlug: string,
  postId: string,
  accessToken: string,
): Promise<{ voteCount: number; hasVoted: false }> {
  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}/posts/${postId}/votes`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ voteCount: number; hasVoted: false }>;
}

// Post detay sayfası (2.4). accessToken opsiyonel: verilirse hasVoted o
// kullanıcıya göre hesaplanır, listPublicPosts'taki ile aynı mantık.
export async function getPost(
  orgSlug: string,
  boardSlug: string,
  postId: string,
  options?: { accessToken?: string },
): Promise<ApiPost | null> {
  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}/posts/${postId}`,
    {
      cache: "no-store",
      headers: options?.accessToken
        ? { Authorization: `Bearer ${options.accessToken}` }
        : undefined,
    },
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiPost>;
}

export async function listComments(
  orgSlug: string,
  boardSlug: string,
  postId: string,
): Promise<ApiComment[]> {
  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}/posts/${postId}/comments`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiComment[]>;
}

export async function createComment(
  orgSlug: string,
  boardSlug: string,
  postId: string,
  accessToken: string,
  body: string,
): Promise<ApiComment> {
  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}/posts/${postId}/comments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiComment>;
}

export async function createPost(
  orgSlug: string,
  boardSlug: string,
  accessToken: string,
  dto: { title: string; description: string },
): Promise<ApiPost> {
  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}/posts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiPost>;
}

// Refresh akışı hâlâ kapsam dışı (bkz. lib/auth-storage.ts) — ama register,
// 2.2'de gözden kaçmış bir eksikti: login formu vardı, hesap açacak bir form
// yoktu. Sonradan (2.2 sonrası bir düzeltme olarak) eklendi.
export async function login(
  email: string,
  password: string,
): Promise<{ user: ApiUser; accessToken: string }> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ user: ApiUser; accessToken: string }>;
}

export async function register(
  email: string,
  password: string,
  name: string,
): Promise<{ user: ApiUser; accessToken: string }> {
  const res = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ user: ApiUser; accessToken: string }>;
}

// Admin panel (Faz 3.1): apps/api'nin GET /organizations'ı (JwtAccessGuard)
// giriş yapmış kullanıcının üye olduğu org'ları role'leriyle döner — org
// switcher'ın veri kaynağı bu, kullanıcının üye olmadığı bir org burada
// hiç görünmez (backend zaten OrganizationMember'a göre filtreliyor,
// frontend ayrıca bir izin kontrolü yapmıyor).
export async function getMyOrganizations(
  accessToken: string,
): Promise<ApiOrganization[]> {
  const res = await fetch(`${API_BASE_URL}/organizations`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiOrganization[]>;
}

// POST /organizations (JwtAccessGuard) — Faz 7.2'de eklendi. API'si
// 1.3'ten beri vardı ama apps/web onu hiç çağırmıyordu: yeni kayıt olan bir
// kullanıcı admin panelinde "Henüz bir workspace'in yok." ekranında
// tıkanıyor, tarayıcıdan workspace açmanın hiçbir yolu olmuyordu. Slug'ı
// backend üretir (OrganizationsService.generateUniqueSlug), buradan sadece
// isim gider.
export async function createOrganization(
  accessToken: string,
  input: { name: string },
): Promise<ApiOrganization> {
  const res = await fetch(`${API_BASE_URL}/organizations`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiOrganization>;
}

// GET /organizations/:orgId/boards (OrgMembershipGuard) — orgId'nin
// gerçekten çağıranın üye olduğu bir org olduğunu apps/api tarafı
// doğruluyor; burada ayrıca bir kontrol yok (2.1'deki BoardsController).
export async function listOrgBoards(
  orgId: string,
  accessToken: string,
): Promise<ApiBoard[]> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/boards`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiBoard[]>;
}

// Faz 6.2 — admin org dashboard'unun 3.1'den beri salt-okunur olan "Board'lar"
// bölümüne ilk gerçek yazma aksiyonu (bkz. o sayfadaki eski yorum: "Board
// yönetimi CRUD UI ayrı bir adım değil"). Burada eklenmesinin gerekçesi tam
// bir board yönetim UI'ı değil — plan limitinin (PlanLimitExceededException)
// tarayıcıda GERÇEKTEN tetiklenip "Pro'ya yükselt"e yönlendirdiğini
// gösterebilecek bir yol olması.
export async function createBoard(
  orgId: string,
  accessToken: string,
  dto: { name: string },
): Promise<ApiBoard> {
  const res = await fetch(`${API_BASE_URL}/organizations/${orgId}/boards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const { message, code } = await parseErrorBody(res);
    throw new ApiError(message, res.status, code);
  }
  return res.json() as Promise<ApiBoard>;
}

// Roadmap kanban (3.2): GET /organizations/:orgId/boards/:boardId/posts —
// public listPublicPosts'tan farklı olarak org üyeliği gerektirir,
// status/search filtresi yok (kanban tüm status'leri tek seferde ister,
// CLOSED dahil — UI 4 kolonda gösterip filtreler).
export async function listOrgBoardPosts(
  orgId: string,
  boardId: string,
  accessToken: string,
): Promise<ApiPost[]> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/boards/${boardId}/posts`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiPost[]>;
}

// Kanban'da bir kartı bir kolondan diğerine sürüklemenin backend
// karşılığı — PATCH /organizations/:orgId/boards/:boardId/posts/:postId/status
// (OWNER|ADMIN). Dönüş değeri ham güncellenmiş post (voteCount/hasVoted
// içermez, apps/api'nin admin-posts.controller.ts'i onları hiç
// hesaplamıyor) — çağıran taraf sadece status'ü local state'te patch'lemek
// için kullanıyor, tüm alanları tüketmiyor.
export async function updatePostStatus(
  orgId: string,
  boardId: string,
  postId: string,
  status: PostStatus,
  accessToken: string,
): Promise<{ id: string; status: PostStatus }> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/boards/${boardId}/posts/${postId}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ status }),
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ id: string; status: PostStatus }>;
}

// Tag yönetimi (3.3) — org-scoped, TagsController'daki aynı ayrım:
// listeleme her org üyesine açık, oluşturma/silme OWNER|ADMIN'e kısıtlı.
export async function listOrgTags(
  orgId: string,
  accessToken: string,
): Promise<ApiTag[]> {
  const res = await fetch(`${API_BASE_URL}/organizations/${orgId}/tags`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiTag[]>;
}

export async function createTag(
  orgId: string,
  accessToken: string,
  dto: { name: string; color?: string },
): Promise<ApiTag> {
  const res = await fetch(`${API_BASE_URL}/organizations/${orgId}/tags`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiTag>;
}

export async function deleteTag(
  orgId: string,
  tagId: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/tags/${tagId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
}

// Post-tag atama (3.3, kanban kartlarından) — tagIds post'un YENİ tam tag
// kümesi (bkz. apps/api PostsService.setPostTags'in yorumu, tek bir
// "replace").
export async function updatePostTags(
  orgId: string,
  boardId: string,
  postId: string,
  tagIds: string[],
  accessToken: string,
): Promise<ApiPost> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/boards/${boardId}/posts/${postId}/tags`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ tagIds }),
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiPost>;
}

// Duplicate merge (3.3, kanban kartlarından) — postId (kaynak/duplicate)
// targetPostId'ye birleştirilir, oyları taşınır (bkz. apps/api
// PostsService.mergePost). Başarılı olursa kaynak post artık hiçbir
// listede görünmez (mergedIntoPostId set edilir) — çağıran taraf kartı
// local state'ten kaldırır.
export async function mergePost(
  orgId: string,
  boardId: string,
  postId: string,
  targetPostId: string,
  accessToken: string,
): Promise<{ id: string; mergedIntoPostId: string }> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/boards/${boardId}/posts/${postId}/merge`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ targetPostId }),
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ id: string; mergedIntoPostId: string }>;
}

// Admin yanıtı (3.4, kanban kartlarından) — public createComment'in
// (2.4) org-scoped, OWNER|ADMIN'e kısıtlı karşılığı, tek farkı sunucunun
// isOfficial:true ile oluşturması. Public post detay sayfası bunu "Resmi
// yanıt" rozetiyle gösterir (bkz. post-detail.tsx → CommentList).
export async function createOfficialComment(
  orgId: string,
  boardId: string,
  postId: string,
  body: string,
  accessToken: string,
): Promise<ApiComment> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/boards/${boardId}/posts/${postId}/comments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiComment>;
}

// Faz 4.3 — widget tema/kimlik ayarları (org admin paneli → Ayarlar).
export interface ApiWidgetSettings {
  color: string;
  logoUrl: string | null;
  secret: string;
}

export async function getWidgetSettings(
  orgId: string,
  accessToken: string,
): Promise<ApiWidgetSettings> {
  const res = await fetch(`${API_BASE_URL}/organizations/${orgId}/widget-settings`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiWidgetSettings>;
}

export async function updateWidgetSettings(
  orgId: string,
  accessToken: string,
  dto: { color?: string; logoUrl?: string },
): Promise<{ color: string; logoUrl: string | null }> {
  const res = await fetch(`${API_BASE_URL}/organizations/${orgId}/widget-settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ color: string; logoUrl: string | null }>;
}

// Eski secret'la imzalanmış her identify isteğini geçersiz kılar (bkz.
// apps/api OrganizationsService.rotateWidgetSecret yorumu) — bu yüzden
// PATCH'in bir parçası değil, kullanıcının bilinçli olarak tıkladığı ayrı
// bir buton/aksiyon.
export async function rotateWidgetSecret(
  orgId: string,
  accessToken: string,
): Promise<{ secret: string }> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/widget-settings/rotate-secret`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ secret: string }>;
}

// Faz 6.1 — Stripe checkout (mock).
// Dönen `url`, API'nin kendi origin'ine göre GÖRELİ bir path
// (`/billing/mock-checkout?...`) — gerçek Stripe'ta bu her zaman
// checkout.stripe.com'a giden MUTLAK bir url olurdu, mock'ta "Stripe" da
// bizim backend'imizin bir parçası olduğu için API_BASE_URL ile
// birleştiriyoruz (bkz. sayfa: settings/page.tsx).
export async function createCheckoutSession(
  orgId: string,
  accessToken: string,
  dto: { successUrl: string; cancelUrl: string },
): Promise<{ id: string; url: string }> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/billing/checkout-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ id: string; url: string }>;
}

// Faz 6.3 — billing sayfasının tek yükleme çağrısı.
export interface ApiInvoice {
  id: string;
  amountCents: number;
  currency: string;
  description: string;
  stripeInvoiceId: string;
  createdAt: string;
}

export interface ApiBillingOverview {
  plan: OrgPlan;
  invoices: ApiInvoice[];
}

export async function getBillingOverview(
  orgId: string,
  accessToken: string,
): Promise<ApiBillingOverview> {
  const res = await fetch(`${API_BASE_URL}/organizations/${orgId}/billing`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiBillingOverview>;
}

// createCheckoutSession'ın Customer Portal karşılığı — dönen `url` de aynı
// şekilde API origin'ine göre GÖRELİ (bkz. createCheckoutSession'ın üstündeki
// yorum).
export async function createPortalSession(
  orgId: string,
  accessToken: string,
  dto: { returnUrl: string },
): Promise<{ url: string }> {
  const res = await fetch(
    `${API_BASE_URL}/organizations/${orgId}/billing/portal-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(dto),
    },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ url: string }>;
}

// Faz 5.4 — in-app bildirim merkezi. Org-scoped değil (kullanıcıya ait),
// bu yüzden diğer fonksiyonların aksine orgSlug/boardSlug parametresi yok.
export interface ApiNotification {
  id: string;
  message: string;
  read: boolean;
  createdAt: string;
  postId: string | null;
  post: {
    id: string;
    title: string;
    board: { slug: string; organization: { slug: string } };
  } | null;
}

export async function listNotifications(
  accessToken: string,
): Promise<ApiNotification[]> {
  const res = await fetch(`${API_BASE_URL}/notifications`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<ApiNotification[]>;
}

export async function markNotificationRead(
  notificationId: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/notifications/${notificationId}/read`,
    { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
}

export async function markAllNotificationsRead(
  accessToken: string,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/notifications/read-all`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
}
