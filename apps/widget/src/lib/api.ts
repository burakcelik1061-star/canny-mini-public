// apps/web/src/lib/api.ts'in trimmed bir kopyası — widget apps/web'e
// bağımlı değil (bkz. vite.config.ts'teki "bağımsız derlenen" yorumu), bu
// yüzden ortak bir pakete taşımak yerine (packages/shared zaten HTTP
// kontratını temsil etmiyor) sadece
// widget'ın gerçekten kullandığı uçlar burada tekrarlandı: board/post
// okuma, oy verme, post oluşturma, login/register. Admin/tag/comment
// uçları widget'ta yok (4.1 kapsamı "minimal").

export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3333";

export type PostStatus =
  | "UNDER_REVIEW"
  | "PLANNED"
  | "IN_PROGRESS"
  | "COMPLETE"
  | "CLOSED";

export const STATUS_LABELS: Record<PostStatus, string> = {
  UNDER_REVIEW: "İnceleniyor",
  PLANNED: "Planlandı",
  IN_PROGRESS: "Geliştiriliyor",
  COMPLETE: "Tamamlandı",
  CLOSED: "Kapatıldı",
};

export interface ApiBoard {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  visibility: "PUBLIC" | "PRIVATE";
  createdAt: string;
}

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

export interface ApiUser {
  id: string;
  email: string;
  name: string;
}

export type PostSort = "new" | "top";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return body.message;
    }
  } catch {
    // JSON olmayan/boş bir gövde — jenerik mesaja düş.
  }
  return `İstek başarısız oldu (${res.status})`;
}

export async function getPublicBoard(
  orgSlug: string,
  boardSlug: string,
): Promise<ApiBoard | null> {
  const res = await fetch(`${API_BASE_URL}/public/${orgSlug}/${boardSlug}`, {
    cache: "no-store",
  });
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
  options?: { sort?: PostSort; accessToken?: string },
): Promise<ApiPost[]> {
  const params = new URLSearchParams();
  if (options?.sort === "top") {
    params.set("sort", "top");
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(
    `${API_BASE_URL}/public/${orgSlug}/${boardSlug}/posts${query}`,
    {
      cache: "no-store",
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

export interface WidgetBranding {
  color: string;
  logoUrl: string | null;
}

// Faz 4.3 — org'un widget rengi/logosu, auth gerektirmez (bkz. apps/api
// AuthService/OrganizationsService.getPublicBranding yorumu).
export async function getBranding(orgSlug: string): Promise<WidgetBranding> {
  const res = await fetch(`${API_BASE_URL}/widget/${orgSlug}/branding`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<WidgetBranding>;
}

// Faz 4.3 — embed script'in (host) imzaladığı identify payload'ını gerçek
// bir oturuma çevirir. login/register'la aynı dönüş şekli (user +
// accessToken) — App.tsx bunu saveAuth ile aynı şekilde işler, ayrı bir
// state modeline ihtiyaç yok.
export async function widgetIdentify(
  orgSlug: string,
  params: { email: string; name: string; timestamp: number; signature: string },
): Promise<{ user: ApiUser; accessToken: string }> {
  const res = await fetch(`${API_BASE_URL}/widget/${orgSlug}/identify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json() as Promise<{ user: ApiUser; accessToken: string }>;
}
