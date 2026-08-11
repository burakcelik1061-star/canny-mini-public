import type { Metadata } from "next";
import { AdminShell } from "@/components/admin-shell";

// Faz 3.1: /admin altındaki her rotayı (index + [orgSlug]/*) sarmalayan
// ortak layout — AdminShell auth/org-switcher/sidebar'ı burada kurar.
export const metadata: Metadata = {
  title: "Admin — Canny mini",
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
