import { notFound } from "next/navigation";
import {
  getPublicBoard,
  isPostStatus,
  listPublicPosts,
  type PostSort,
  type PostStatus,
} from "@/lib/api";
import { BoardPage } from "./board-page";

// Herkese açık board sayfası (Faz 2.2/2.3/2.5): apps/api'deki
// GET /public/:orgSlug/:boardSlug[...] uçlarına karşılık gelir — auth
// gerektirmez, sadece PUBLIC board'lar görünür (bkz.
// apps/api/src/boards/boards.service.ts → getPublicBoard).
export default async function Page(
  props: PageProps<"/[orgSlug]/[boardSlug]">,
) {
  const { orgSlug, boardSlug } = await props.params;
  const searchParams = await props.searchParams;
  const sort: PostSort = searchParams.sort === "top" ? "top" : "new";
  const status: PostStatus | undefined = isPostStatus(searchParams.status)
    ? searchParams.status
    : undefined;
  const search =
    typeof searchParams.search === "string" && searchParams.search.trim()
      ? searchParams.search.trim()
      : undefined;
  const tag =
    typeof searchParams.tag === "string" && searchParams.tag.trim()
      ? searchParams.tag.trim()
      : undefined;

  const board = await getPublicBoard(orgSlug, boardSlug);
  if (!board) {
    notFound();
  }

  const posts = await listPublicPosts(orgSlug, boardSlug, {
    sort,
    status,
    search,
    tag,
  });

  return (
    // key: sort/status/search/tag değişince BoardPage'in kendi post state'i
    // sıfırdan initialPosts'tan kurulsun diye bilinçli olarak remount
    // ettiriyoruz — prop değişimini effect ile senkronize etmek yerine.
    <BoardPage
      key={`${sort}-${status ?? "all"}-${search ?? ""}-${tag ?? "all"}`}
      orgSlug={orgSlug}
      boardSlug={boardSlug}
      board={board}
      initialPosts={posts}
      sort={sort}
      status={status}
      search={search}
      tag={tag}
    />
  );
}
