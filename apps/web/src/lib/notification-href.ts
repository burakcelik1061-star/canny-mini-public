import type { ApiNotification } from "./api";

// NotificationBell'in bir bildirime tıklanınca nereye Link vereceğini
// hesaplayan tek yer — pure fonksiyon olarak ayrıldı ki (buildHref'in
// board-page.tsx'teki deseniyle aynı gerekçe) bileşeni render etmeden test
// edilebilsin. `post` null ise (ör. ileride post silme eklenirse) bildirim
// hâlâ listede görünür ama tıklanamaz bir metin olarak kalır.
export function notificationHref(notification: ApiNotification): string | null {
  if (!notification.post) {
    return null;
  }
  const { post } = notification;
  return `/${post.board.organization.slug}/${post.board.slug}/${post.id}`;
}
