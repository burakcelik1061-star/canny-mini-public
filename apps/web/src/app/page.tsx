import Link from "next/link";

// Faz 7.4 — buraya kadar create-next-app'in starter şablonu duruyordu
// (Next.js/Vercel logoları, "Deploy Now" linkleri). Vercel/Railway
// kullanılmayacağına karar verildiği için
// o içerik tamamen kaldırıldı ve yerine projenin kendi giriş sayfası
// yazıldı: seed script'inin (prisma/seed.ts) oluşturduğu demo board'a ve
// admin paneline giden iki gerçek link.
//
// Bilinçli olarak minimal: bu bir pazarlama sayfası değil, "uygulamayı
// local'de açan biri nereden başlayacağını bilsin" sayfası. Gerçek proje
// anlatımı README'ye gidecek (Faz 7.5).

const DEMO_ORG_SLUG = "demo";
const DEMO_BOARD_SLUG = "feedback";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <main className="flex w-full max-w-2xl flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Feedback &amp; Roadmap Platform
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Multi-tenant bir geri bildirim panosu, roadmap ve gömülebilir
            widget. Kullanıcılar öneri açar ve oy verir; ekip önerileri bir
            kanban üzerinde yönetir, durum değiştikçe oy verenlere bildirim
            gider.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/${DEMO_ORG_SLUG}/${DEMO_BOARD_SLUG}`}
            className="rounded-full bg-foreground px-5 py-2.5 text-center text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Demo board&apos;u gör
          </Link>
          <Link
            href="/admin"
            className="rounded-full border border-black/15 px-5 py-2.5 text-center text-sm font-medium transition-colors hover:bg-black/[.05] dark:border-white/20 dark:hover:bg-white/[.08]"
          >
            Admin paneli
          </Link>
        </div>

        <p className="text-sm text-zinc-500">
          Demo board boşsa seed script&apos;i henüz çalıştırılmamış demektir:{" "}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
            pnpm --filter api seed
          </code>
        </p>
      </main>
    </div>
  );
}
