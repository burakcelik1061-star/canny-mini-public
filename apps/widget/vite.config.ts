import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// apps/web (Next.js) yerine düz Vite: widget'ın "bağımsız derlenen, minimal
// bundle" olması gerekiyor (4.1 prompt'u) — Next'in SSR/routing/runtime'ı
// burada gereksiz ağırlık. `base: "./"` bilinçli: `dist/` başka bir sitenin
// iframe'ine herhangi bir path'ten sunulabilir (gömen sitenin kendi
// statik dosya sunucusu ya da apps/api'nin serve ettiği bir yol olabilir,
// 4.2'nin embed script'i bunu belirleyecek) — mutlak "/" asset yolları
// yanlış origin'den asset ister.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // apps/api'nin varsayılan WEB_ORIGIN'i (bkz. apps/api/src/main.ts) artık
  // hem apps/web'in :3000'ini hem widget'ın bu sabit :5173'ünü kabul ediyor
  // — port kaymasın diye strictPort true.
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
});
