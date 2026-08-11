// Admin index: org seçilmeden önceki hal. Asıl org-switcher AdminShell'in
// sidebar'ında (bkz. components/admin-shell.tsx) — burada sadece
// kullanıcıyı oraya yönlendiren bir metin var, listeyi tekrar etmiyoruz.
export default function AdminIndexPage() {
  return (
    <p className="text-sm text-zinc-500">
      Soldaki listeden bir workspace seç.
    </p>
  );
}
