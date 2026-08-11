import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWidgetIdentify, type IdentifyStatus } from "./use-widget-identify";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const { widgetIdentifyMock, saveAuthMock } = vi.hoisted(() => ({
  widgetIdentifyMock: vi.fn(),
  saveAuthMock: vi.fn(),
}));

vi.mock("./api", () => ({ widgetIdentify: widgetIdentifyMock }));
vi.mock("./auth-storage", () => ({ saveAuth: saveAuthMock }));

// useWidgetIdentify — Faz 4.3'ün asıl güvenlik/UX mantığı: embed.ts'in
// iletebileceği bir identify payload'ı varsa VE henüz bir oturum yoksa
// otomatik "giriş" dener; ikisi de gerçek bir tarayıcıda (readIdentify
// window.location.search'ü okuyor) çalıştığı için burada da URL'i
// değiştirip test ediyoruz — App.test.ts'teki readIdentify testleriyle
// aynı teknik.
describe("useWidgetIdentify", () => {
  let container: HTMLDivElement;
  let root: Root;
  let lastStatus: IdentifyStatus | undefined;

  function TestHarness({
    orgSlug,
    auth,
  }: {
    orgSlug: string;
    auth: Parameters<typeof useWidgetIdentify>[1];
  }) {
    lastStatus = useWidgetIdentify(orgSlug, auth);
    return null;
  }

  beforeEach(() => {
    widgetIdentifyMock.mockReset();
    saveAuthMock.mockReset();
    lastStatus = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
  });

  function mount(auth: Parameters<typeof useWidgetIdentify>[1] = null) {
    root = createRoot(container);
    act(() => {
      root.render(<TestHarness orgSlug="acme" auth={auth} />);
    });
  }

  it("identify query'si yoksa \"skip\" döner ve API'yi hiç çağırmaz", () => {
    window.history.replaceState(null, "", "/?org=acme&board=feedback");
    mount();
    expect(lastStatus).toBe("skip");
    expect(widgetIdentifyMock).not.toHaveBeenCalled();
  });

  it("zaten bir oturum varsa identify query'si olsa bile \"skip\" döner", () => {
    window.history.replaceState(
      null,
      "",
      "/?identifyEmail=a%40b.com&identifyName=Ada&identifyTs=1700000000000&identifySig=abcd",
    );
    mount({
      user: { id: "u1", email: "existing@example.com", name: "Existing" },
      accessToken: "already-logged-in",
    });
    expect(lastStatus).toBe("skip");
    expect(widgetIdentifyMock).not.toHaveBeenCalled();
  });

  it("geçerli identify query'si + oturum yoksa \"pending\" ile başlar, API'yi orgSlug ve params ile çağırır", () => {
    window.history.replaceState(
      null,
      "",
      "/?identifyEmail=a%40b.com&identifyName=Ada&identifyTs=1700000000000&identifySig=abcd",
    );
    widgetIdentifyMock.mockReturnValue(new Promise(() => {})); // hiç çözülmesin — "pending" durumunu gözlemleyebilelim
    mount();

    expect(lastStatus).toBe("pending");
    expect(widgetIdentifyMock).toHaveBeenCalledWith("acme", {
      email: "a@b.com",
      name: "Ada",
      timestamp: 1700000000000,
      signature: "abcd",
    });
  });

  it("API başarılı olursa saveAuth çağrılır", async () => {
    window.history.replaceState(
      null,
      "",
      "/?identifyEmail=a%40b.com&identifyName=Ada&identifyTs=1700000000000&identifySig=abcd",
    );
    const result = {
      user: { id: "u1", email: "a@b.com", name: "Ada" },
      accessToken: "fresh-token",
    };
    widgetIdentifyMock.mockResolvedValue(result);

    await act(async () => {
      mount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveAuthMock).toHaveBeenCalledWith(result);
  });

  it("API reddederse (yanlış imza/süresi dolmuş) \"failed\" olur, saveAuth çağrılmaz", async () => {
    window.history.replaceState(
      null,
      "",
      "/?identifyEmail=a%40b.com&identifyName=Ada&identifyTs=1700000000000&identifySig=abcd",
    );
    widgetIdentifyMock.mockRejectedValue(new Error("Geçersiz identify imzası"));

    await act(async () => {
      mount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(lastStatus).toBe("failed");
    expect(saveAuthMock).not.toHaveBeenCalled();
  });
});
