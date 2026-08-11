import { describe, expect, it } from "vitest";
import { isHostToWidgetMessage, isWidgetToHostMessage } from "./embed-protocol";

// isWidgetToHostMessage/isHostToWidgetMessage, embed.ts'in (host) ve
// App.tsx'in (widget) rastgele bir postMessage'ı kendi protokolleri sanıp
// işlememesini sağlayan tek güvenlik kontrolü (bkz. embed-protocol.ts'in
// başındaki yorum — targetOrigin bazı yönlerde "*" olduğu için bu kontrol
// tek gerçek filtre). "kritik iş mantığı test
// edilmeden tamamlanmaz" ilkesi burada uygulanıyor.
describe("isWidgetToHostMessage", () => {
  it("doğru source ile true döner", () => {
    expect(
      isWidgetToHostMessage({ source: "canny-mini-widget", type: "ready" }),
    ).toBe(true);
  });

  it("yanlış/eksik source ile false döner", () => {
    expect(isWidgetToHostMessage({ source: "canny-mini-host", type: "ready" })).toBe(
      false,
    );
    expect(isWidgetToHostMessage({ type: "ready" })).toBe(false);
  });

  it("primitive/null değerlerle false döner (başka bir sayfanın rastgele postMessage'ı)", () => {
    expect(isWidgetToHostMessage(null)).toBe(false);
    expect(isWidgetToHostMessage("canny-mini-widget")).toBe(false);
    expect(isWidgetToHostMessage(42)).toBe(false);
    expect(isWidgetToHostMessage(undefined)).toBe(false);
  });
});

describe("isHostToWidgetMessage", () => {
  it("doğru source ile true döner", () => {
    expect(
      isHostToWidgetMessage({
        source: "canny-mini-host",
        type: "set-theme",
        theme: "dark",
      }),
    ).toBe(true);
  });

  it("widget'ın kendi source'uyla (yanlış yön) false döner", () => {
    expect(
      isHostToWidgetMessage({ source: "canny-mini-widget", type: "ready" }),
    ).toBe(false);
  });

  it("primitive/null değerlerle false döner", () => {
    expect(isHostToWidgetMessage(null)).toBe(false);
    expect(isHostToWidgetMessage(123)).toBe(false);
  });
});
