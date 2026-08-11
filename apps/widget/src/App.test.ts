import { describe, expect, it, afterEach } from "vitest";
import { readIdentify, readTarget } from "./lib/target";

// readTarget, widget'ın iframe src'sindeki ?org=&board= query'sini okuyan
// tek "yönlendirme mantığı" — react-router yok (bkz. App.tsx yorumu), bu
// yüzden "kritik iş mantığı test edilir"
// ilkesini burada uygulayacak tek gerçek birim bu.
describe("readTarget", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("org ve board query parametreleri verilince ikisini de döner", () => {
    window.history.replaceState(null, "", "/?org=acme&board=feedback");
    expect(readTarget()).toEqual({ org: "acme", board: "feedback" });
  });

  it("org eksikse null döner", () => {
    window.history.replaceState(null, "", "/?board=feedback");
    expect(readTarget()).toBeNull();
  });

  it("board eksikse null döner", () => {
    window.history.replaceState(null, "", "/?org=acme");
    expect(readTarget()).toBeNull();
  });

  it("hiç query yoksa null döner", () => {
    window.history.replaceState(null, "", "/");
    expect(readTarget()).toBeNull();
  });
});

// readIdentify — Faz 4.3, embed.ts'in (host) iframe src'sine eklediği
// identify* query'lerini okur (bkz. lib/target.ts yorumu). "Hepsi ya da
// hiçbiri" davranışı burada test ediliyor: dördünden biri eksikse widget
// sessizce kendi login formuna düşmeli (yarım/bozuk bir identify denemesi
// yerine).
describe("readIdentify", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("dört parametre de verilince timestamp'i sayıya çevirip döner", () => {
    window.history.replaceState(
      null,
      "",
      "/?identifyEmail=a%40b.com&identifyName=Ada&identifyTs=1700000000000&identifySig=abcd",
    );
    expect(readIdentify()).toEqual({
      email: "a@b.com",
      name: "Ada",
      timestamp: 1700000000000,
      signature: "abcd",
    });
  });

  it("signature eksikse null döner", () => {
    window.history.replaceState(
      null,
      "",
      "/?identifyEmail=a%40b.com&identifyName=Ada&identifyTs=1700000000000",
    );
    expect(readIdentify()).toBeNull();
  });

  it("timestamp sayı değilse null döner", () => {
    window.history.replaceState(
      null,
      "",
      "/?identifyEmail=a%40b.com&identifyName=Ada&identifyTs=not-a-number&identifySig=abcd",
    );
    expect(readIdentify()).toBeNull();
  });

  it("hiç identify query'si yoksa null döner", () => {
    window.history.replaceState(null, "", "/?org=acme&board=feedback");
    expect(readIdentify()).toBeNull();
  });
});
