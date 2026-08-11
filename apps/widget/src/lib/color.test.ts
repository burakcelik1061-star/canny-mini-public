import { describe, expect, it } from "vitest";
import { pickAccentTextColor } from "./color";

describe("pickAccentTextColor", () => {
  it("koyu bir arka plan için beyaz metin seçer", () => {
    expect(pickAccentTextColor("#171717")).toBe("#ffffff");
  });

  it("açık bir arka plan için siyah metin seçer", () => {
    expect(pickAccentTextColor("#ffff00")).toBe("#000000");
  });

  it("saf beyaz için siyah metin seçer", () => {
    expect(pickAccentTextColor("#ffffff")).toBe("#000000");
  });

  it("saf siyah için beyaz metin seçer", () => {
    expect(pickAccentTextColor("#000000")).toBe("#ffffff");
  });

  it("geçersiz bir hex için eski varsayılana (beyaz) düşer", () => {
    expect(pickAccentTextColor("not-a-color")).toBe("#ffffff");
    expect(pickAccentTextColor("#zzzzzz")).toBe("#ffffff");
  });
});
