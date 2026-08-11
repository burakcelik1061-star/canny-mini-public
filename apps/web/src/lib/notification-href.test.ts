import { describe, expect, it } from "vitest";
import type { ApiNotification } from "./api";
import { notificationHref } from "./notification-href";

const baseNotification: ApiNotification = {
  id: "notif-1",
  message: "test",
  read: false,
  createdAt: "2026-08-06T00:00:00.000Z",
  postId: "post-1",
  post: {
    id: "post-1",
    title: "Dark mode ekle",
    board: { slug: "features", organization: { slug: "acme" } },
  },
};

describe("notificationHref", () => {
  it("post varsa org/board/post slug'larından bir link üretir", () => {
    expect(notificationHref(baseNotification)).toBe(
      "/acme/features/post-1",
    );
  });

  it("post yoksa (ör. silinmiş) null döner", () => {
    expect(notificationHref({ ...baseNotification, post: null })).toBeNull();
  });
});
