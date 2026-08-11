import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEmbedSync } from "./use-embed-sync";
import { HOST_MESSAGE_SOURCE, WIDGET_MESSAGE_SOURCE } from "./embed-protocol";

// React 19'un `act`'i (react-dom/test-utils değil, `react`'ten) jsdom'un
// gerçek bir tarayıcı olmadığını bu global işaretle anlıyor — yoksa
// "not configured to support act" uyarısı verip testleri (yanlışlıkla
// senkronmuş gibi) yine de çalıştırıyor. Testler zaten doğru sonuç
// veriyordu ama uyarı gürültüsü gerçek bir hatayı gizleyebilirdi.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// useEmbedSync gerçek bir tarayıcıda (embed-test.html + vite preview ile,
//.2 doğrulama notu) uçtan uca doğrulandı, ama
// ResizeObserver'ın callback'i tarayıcının render/paint döngüsüne bağlı —
// bu yüzden burada da jsdom + sahte bir ResizeObserver ile hook'un mantığını
// (postMessage çağrıları, "ready"/"resize"/"set-theme" akışı) tarayıcı
// zamanlamasından bağımsız, deterministik olarak test ediyoruz.
// "kritik iş mantığı test edilir" ilkesi.

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
  // Testin gerçek tarayıcı yerine kendi elleriyle tetiklediği "resize oldu" sinyali.
  trigger(height: number) {
    this.callback(
      [{ contentRect: { height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function TestHarness({ rootRef }: { rootRef: React.RefObject<HTMLDivElement | null> }) {
  useEmbedSync(rootRef);
  return null;
}

describe("useEmbedSync", () => {
  let container: HTMLDivElement;
  let root: Root;
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let originalResizeObserver: unknown;
  let originalParent: Window;

  beforeEach(() => {
    originalResizeObserver = (globalThis as { ResizeObserver?: unknown })
      .ResizeObserver;
    (globalThis as { ResizeObserver: unknown }).ResizeObserver =
      FakeResizeObserver;
    FakeResizeObserver.instances = [];

    // window.parent normalde jsdom'da window'un kendisi (top-level) — iframe
    // içinde gömülü olma durumunu simüle etmek için sahte bir parent
    // veriyoruz (isEmbedded === true olsun diye, bkz. use-embed-sync.ts).
    originalParent = window.parent;
    postMessageSpy = vi.fn();
    Object.defineProperty(window, "parent", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as { ResizeObserver: unknown }).ResizeObserver =
      originalResizeObserver;
    Object.defineProperty(window, "parent", {
      value: originalParent,
      configurable: true,
    });
    document.documentElement.removeAttribute("data-theme");
  });

  function mount() {
    const rootRef: React.RefObject<HTMLDivElement | null> = { current: null };
    const wrapper = document.createElement("div");
    rootRef.current = wrapper;
    root = createRoot(container);
    act(() => {
      root.render(<TestHarness rootRef={rootRef} />);
    });
    return rootRef;
  }

  it("mount olunca host'a \"ready\" mesajı gönderir", () => {
    mount();
    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: WIDGET_MESSAGE_SOURCE, type: "ready" },
      "*",
    );
  });

  it("ResizeObserver yükseklik bildirince host'a \"resize\" mesajı gönderir", () => {
    mount();
    expect(FakeResizeObserver.instances).toHaveLength(1);
    act(() => {
      FakeResizeObserver.instances[0].trigger(432);
    });
    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: WIDGET_MESSAGE_SOURCE, type: "resize", height: 432 },
      "*",
    );
  });

  it("aynı yükseklik tekrar bildirilirse ikinci bir mesaj göndermez", () => {
    mount();
    const observer = FakeResizeObserver.instances[0];
    act(() => observer.trigger(300));
    postMessageSpy.mockClear();
    act(() => observer.trigger(300));
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it("host'tan gelen set-theme mesajını data-theme attribute'una uygular", () => {
    mount();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: HOST_MESSAGE_SOURCE, type: "set-theme", theme: "dark" },
        }),
      );
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("theme \"auto\" ise data-theme attribute'unu kaldırır", () => {
    mount();
    document.documentElement.setAttribute("data-theme", "dark");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: HOST_MESSAGE_SOURCE, type: "set-theme", theme: "auto" },
        }),
      );
    });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("protokole uymayan (source'suz) bir mesajı yok sayar", () => {
    mount();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "set-theme", theme: "dark" } }),
      );
    });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
