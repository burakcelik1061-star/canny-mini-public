"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type ApiNotification,
} from "@/lib/api";
import { useStoredAuth } from "@/lib/auth-storage";
import { notificationHref } from "@/lib/notification-href";

const POLL_INTERVAL_MS = 30_000;

// Faz 5.4 (opsiyonel) — "basit bir in-app bildirim listesi" (prompt-library).
// Bilinçli olarak minimal: websocket/SSE yok, 30sn'de bir polling — 5.2'nin
// zaten var olan email bildirimiyle aynı olaydan (status değişikliği)
// besleniyor, aynı anda gerçek zamanlı olmasını gerektiren bir kullanım
// senaryosu yok. Giriş yapılmamışsa hiçbir şey render etmiyor (AuthForms'un
// göründüğü her yerde kullanılabilir).
export function NotificationBell() {
  const auth = useStoredAuth();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [open, setOpen] = useState(false);

  // Menü VARSAYILAN olarak butonun solundan başlayıp SAĞA doğru açılır (boş
  // alana). Ama zil sağ kenara yakınsa (public board header'ı, dar ekran)
  // sağda yer kalmaz ve panel ekran dışına taşardı — o durumda sağa hizalanıp
  // sola açılır. Yani: her zaman YER OLAN tarafa açılır.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel) return;
    // Ölçüm mevcut hizalamadan BAĞIMSIZ: butonun sol kenarından sağa doğru
    // panel genişliği sığıyor mu? (döngüye girmez, aynı değerde React bail eder)
    const buttonLeft = button.getBoundingClientRect().left;
    const roomToRight = document.documentElement.clientWidth - buttonLeft;
    setAlignRight(panel.offsetWidth + 8 > roomToRight);
  }, [open, notifications.length]);

  useEffect(() => {
    if (!auth) {
      return;
    }
    const accessToken = auth.accessToken;
    let cancelled = false;

    function load() {
      listNotifications(accessToken)
        .then((result) => {
          if (!cancelled) setNotifications(result);
        })
        .catch(() => {
          // Sessizce yut — zil "iyi niyetli" bir özellik, başarısız bir
          // fetch sayfanın geri kalanını bozmamalı (board-page.tsx'teki tag
          // listesi yüklenemezse de aynı davranış).
        });
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      // Effect'in temizlik fonksiyonu — auth değişince (logout ya da farklı
      // bir kullanıcıyla giriş) önceki kullanıcının listesi burada
      // temizleniyor. Bunu effect gövdesinde doğrudan (erken `return`'den
      // önce) yapmak "setState in effect body" kuralına takılıyordu; cleanup
      // içinde yapmak abone-ol/vazgeç desenine uygun.
      cancelled = true;
      clearInterval(interval);
      setNotifications([]);
    };
  }, [auth]);

  if (!auth) {
    return null;
  }

  const unreadCount = notifications.filter((n) => !n.read).length;
  const accessToken = auth.accessToken;

  function markOneReadLocally(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }

  async function handleItemClick(notification: ApiNotification) {
    setOpen(false);
    if (notification.read) {
      return;
    }
    markOneReadLocally(notification.id);
    try {
      await markNotificationRead(notification.id, accessToken);
    } catch {
      // Sessizce yut — bir sonraki poll gerçek durumu düzeltir.
    }
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await markAllNotificationsRead(accessToken);
    } catch {
      // Sessizce yut — bir sonraki poll gerçek durumu düzeltir.
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Bildirimler"
        aria-expanded={open}
        className="relative rounded-full p-2 text-lg hover:bg-black/[.06] dark:hover:bg-white/[.08]"
      >
        <span aria-hidden>🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className={`absolute z-10 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-black/10 bg-background p-2 shadow-lg dark:border-white/15 ${
            alignRight ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-medium text-zinc-500">
              Bildirimler
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Tümünü okundu işaretle
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="px-2 py-3 text-sm text-zinc-500">
              Henüz bir bildirimin yok.
            </p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onClick={() => handleItemClick(notification)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onClick,
}: {
  notification: ApiNotification;
  onClick: () => void;
}) {
  const href = notificationHref(notification);
  const body = (
    <div
      className={`rounded-md px-2 py-2 text-sm ${
        notification.read
          ? "text-zinc-500"
          : "font-medium text-black dark:text-zinc-50"
      } hover:bg-black/[.06] dark:hover:bg-white/[.08]`}
    >
      <p>{notification.message}</p>
      <p className="text-xs text-zinc-400">
        {new Date(notification.createdAt).toLocaleString("tr-TR")}
      </p>
    </div>
  );

  return (
    <li>
      {href ? (
        <Link href={href} onClick={onClick}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className="w-full text-left">
          {body}
        </button>
      )}
    </li>
  );
}
