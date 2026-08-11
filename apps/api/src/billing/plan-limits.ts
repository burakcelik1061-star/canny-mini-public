import { Plan } from '@prisma/client';

export interface PlanLimits {
  // null = sınırsız.
  maxBoards: number | null;
  maxMembers: number | null;
}

// Faz 6.2 — 0.1 dokümanındaki ("Plan bazlı board/üye limiti") kararın
// somutlaştığı tek yer. Sayılar bir ürün kararı: FREE gerçekten kısıtlayıcı
// (tek board — gerçek Canny'nin free planıyla aynı çizgide, küçük bir ekip)
// ama demo/portfolyo taraması sırasında kullanılamaz olmayacak kadar cömert
// (owner + 2 üye). PRO sınırsız (`null`) — Faz 6.1'in
// `handleWebhookEvent`'i org'u PRO yapınca bu limitler otomatik devre dışı
// kalır, ayrı bir "sınırsız plan" kodu yazılmadı.
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { maxBoards: 1, maxMembers: 3 },
  PRO: { maxBoards: null, maxMembers: null },
};
