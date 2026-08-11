import { PostStatus } from '@prisma/client';

// apps/web/src/lib/api.ts'teki STATUS_LABELS'ın backend tarafındaki küçük
// bir kopyası — apps/widget'ın apps/web'e bağımlı olmama kararıyla
// aynı gerekçe: apps/api apps/web'e asla
// bağımlı olmamalı, email içeriği için gereken tek şey bu 5 satırlık map.
export const STATUS_LABELS: Record<PostStatus, string> = {
  UNDER_REVIEW: 'İnceleniyor',
  PLANNED: 'Planlandı',
  IN_PROGRESS: 'Geliştiriliyor',
  COMPLETE: 'Tamamlandı',
  CLOSED: 'Kapatıldı',
};
