"use client";

// Board sayfası (2.2), post detay sayfası (2.4) ve admin panelinin (3.1)
// ortak giriş/kayıt formu. Başlangıçta [orgSlug]/[boardSlug]/shared.tsx
// içindeydi (public board akışına özgüydü); admin skeleton'ın da aynı
// "giriş yapmalısın" ekranına ihtiyacı olunca buraya, üst seviye bir
// bileşene taşındı. `shared.tsx` geriye dönük uyumluluk için buradan
// re-export ediyor, board-page.tsx/post-detail.tsx'in importları
// değişmedi.

import { useState, type FormEvent } from "react";
import { ApiError, login, register } from "@/lib/api";
import { saveAuth } from "@/lib/auth-storage";

export function AuthForms({
  prompt = "Devam etmek için giriş yap.",
}: {
  prompt?: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");

  return mode === "register" ? (
    <RegisterForm onSwitchToLogin={() => setMode("login")} />
  ) : (
    <LoginForm prompt={prompt} onSwitchToRegister={() => setMode("register")} />
  );
}

function LoginForm({
  prompt,
  onSwitchToRegister,
}: {
  prompt: string;
  onSwitchToRegister: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { user, accessToken } = await login(email, password);
      saveAuth({ user, accessToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Giriş başarısız oldu");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{prompt}</p>
      <input
        type="email"
        required
        placeholder="email@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      />
      <input
        type="password"
        required
        placeholder="Şifre"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {submitting ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
      <button
        type="button"
        onClick={onSwitchToRegister}
        className="text-left text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        Hesabın yok mu? Kayıt ol
      </button>
    </form>
  );
}

function RegisterForm({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { user, accessToken } = await register(email, password, name);
      // LoginForm'daki gibi: kayıt başarılı olur olmaz giriş yapılmış say —
      // apps/api zaten register'da da accessToken döner (bkz. AuthController).
      saveAuth({ user, accessToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kayıt başarısız oldu");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Hesap oluştur.
      </p>
      <input
        type="text"
        required
        placeholder="İsim"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      />
      <input
        type="email"
        required
        placeholder="email@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      />
      <input
        type="password"
        required
        minLength={8}
        placeholder="Şifre (en az 8 karakter)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {submitting ? "Kayıt olunuyor…" : "Kayıt ol"}
      </button>
      <button
        type="button"
        onClick={onSwitchToLogin}
        className="text-left text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        Zaten hesabın var mı? Giriş yap
      </button>
    </form>
  );
}
