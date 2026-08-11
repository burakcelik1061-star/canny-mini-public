import { useSyncExternalStore } from "react";
import type { ApiUser } from "./api";

// apps/web/src/lib/auth-storage.ts ile aynı desen (useSyncExternalStore +
// localStorage). Ayrı bir key kullanıyor ("canny-mini-widget:auth") — ama
// bu zaten şart değil: widget farklı bir origin'den (iframe src) sunulduğu
// için tarayıcı localStorage'ı zaten apps/web'inkinden izole ediyor, aynı
// key olsa bile çakışmazdı. Widget kullanıcısının oturumu bu yüzden
// apps/web'deki oturumdan bağımsız — "gömen sitenin kendi kullanıcısını
// widget'a aktarabilmesi" (identity federasyonu) 4.3'ün kapsamı.
const STORAGE_KEY = "canny-mini-widget:auth";

export interface StoredAuth {
  user: ApiUser;
  accessToken: string;
}

let cache: StoredAuth | null | undefined;
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
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
