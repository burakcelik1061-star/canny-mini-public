import { useSyncExternalStore } from "react";
import type { ApiUser } from "./api";

// Faz 2.2'nin ihtiyacı: "post oluşturmak için giriş yapmış olmak" akışını
// tarayıcıda gerçekten test edebilmek. Refresh token akışı (httpOnly cookie,
// bkz. apps/api AuthController) burada kullanılmıyor — accessToken 15dk
// sonra geçersiz olur, kullanıcı o zaman yeniden giriş yapar. Kalıcı oturum
// (refresh, silent login vb.) sonraki bir adımın kapsamı.
const STORAGE_KEY = "canny-mini:auth";

export interface StoredAuth {
  user: ApiUser;
  accessToken: string;
}

// useSyncExternalStore ile: localStorage bir "harici sistem", React state'i
// değil — bunu bir effect içinde setState ile React state'ine kopyalamak
// (react-hooks/set-state-in-effect kuralının da uyardığı gibi) gereksiz bir
// cascading render'a yol açıyor. Bunun yerine localStorage'ı doğrudan
// senkronize bir "store" olarak React'e bağlıyoruz.
let cache: StoredAuth | null | undefined; // undefined = henüz okunmadı
const listeners = new Set<() => void>();

function readFromStorage(): StoredAuth | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

function getSnapshot(): StoredAuth | null {
  if (cache === undefined) {
    cache = readFromStorage();
  }
  return cache;
}

// SSR sırasında localStorage yok — sunucu her zaman "giriş yapılmamış"
// render eder, tarayıcıda gerçek değere hidrasyon sonrası geçilir.
function getServerSnapshot(): StoredAuth | null {
  return null;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function useStoredAuth(): StoredAuth | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function saveAuth(auth: StoredAuth): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  cache = auth;
  emitChange();
}

export function clearAuth(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  cache = null;
  emitChange();
}
