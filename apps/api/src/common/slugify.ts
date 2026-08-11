// apps/web/src/lib/slugify.ts ile birebir aynı algoritma. packages/shared henüz
// derleme adımı olmayan "ham TS" bir paket (bkz. packages/shared/src/index.ts) —
// bir bundler/ts-node olmadan (nest build -> node dist/main.js) runtime'da
// .ts dosyası require edilemeyeceği için burada bilinçli olarak tekilleştirildi.
// packages/shared'a build adımı eklenirse buradan oraya taşınıp consolide edilebilir.
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ı/g, 'i') // Turkish dotless i has no NFKD decomposition
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accent marks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
