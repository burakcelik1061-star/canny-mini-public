// Small utility used later (Faz 1: organization slug, Faz 2: board slug).
// Not just a CI placeholder — this is real code we'll actually import.
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ı/g, "i") // Turkish dotless i has no NFKD decomposition
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accent marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
