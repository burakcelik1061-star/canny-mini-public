"use client";

// Board listesi (board-page.tsx) ile post detay sayfası (2.4,
// [postId]/post-detail.tsx) arasında paylaşılan küçük UI parçaları —
// STATUS_LABELS, oy butonu, giriş formu. İkisinde de aynı görünüm/davranış
// gerektiği için burada tekilleştirildi.

// AuthForms/STATUS_LABELS artık burada tanımlı değil — admin panelinin
// (3.1/3.2) de aynılarına ihtiyaç olunca sırasıyla
// @/components/auth-forms.tsx ve @/lib/api.ts'e taşındı. Bu re-export'lar,
// board-page.tsx/post-detail.tsx'in mevcut `from "./shared"` importlarını
// bozmamak için.
export { AuthForms } from "@/components/auth-forms";
export { STATUS_LABELS } from "@/lib/api";

export function VoteButton({
  voteCount,
  hasVoted,
  canVote,
  onToggle,
}: {
  voteCount: number;
  hasVoted: boolean;
  canVote: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!canVote}
      onClick={onToggle}
      title={canVote ? undefined : "Oy vermek için giriş yap"}
      aria-pressed={hasVoted}
      className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
        hasVoted
          ? "border-foreground bg-foreground text-background"
          : "border-black/15 text-zinc-700 hover:border-black/30 disabled:hover:border-black/15 dark:border-white/20 dark:text-zinc-300 dark:disabled:hover:border-white/20"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span aria-hidden>▲</span>
      <span>{voteCount}</span>
    </button>
  );
}
