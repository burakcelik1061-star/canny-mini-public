import { defineConfig } from "vite";

// Ana widget app'inin (vite.config.ts) AYRI bir ikinci build hedefi —
// `pnpm build` ikisini de sırayla çalıştırıyor (bkz. package.json).
// embed.js React'e bağımlı değil (bkz. embed/embed.ts'in başındaki yorum),
// bu yüzden react() plugin'i burada yok ve `emptyOutDir: false` şart:
// ana build zaten dist/'i (index.html + assets) doldurmuş oluyor, bu
// ikinci build onu silmeden sadece embed.js'i eklemeli.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: "embed/embed.ts",
      name: "CannyMiniEmbed",
      formats: ["iife"],
      fileName: () => "embed.js",
    },
  },
});
