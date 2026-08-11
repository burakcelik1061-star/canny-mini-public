// org.widgetColor (4.3) rastgele bir hex olabilir — sabit beyaz metin
// (styles.css'in eski varsayılanı) açık renklerde (ör. sarı) okunmaz hale
// gelirdi. WCAG'ın basitleştirilmiş bir hali: relative luminance hesaplanıp
// eşiğe göre siyah/beyaz metin seçiliyor — tam kontrast oranı hesabı (APCA/
// WCAG 2.x) bu ölçekte gereksiz karmaşıklık, "çoğu durumda okunaklı" yeterli.
export function pickAccentTextColor(hex: string): "#000000" | "#ffffff" {
  const rgb = parseHexColor(hex);
  if (!rgb) {
    return "#ffffff"; // geçersiz bir renk gelirse eski varsayılana düş
  }
  const luminance = relativeLuminance(rgb);
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

function parseHexColor(
  hex: string,
): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) {
    return null;
  }
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function relativeLuminance({
  r,
  g,
  b,
}: {
  r: number;
  g: number;
  b: number;
}): number {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
