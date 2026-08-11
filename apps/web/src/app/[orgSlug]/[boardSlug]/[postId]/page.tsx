import { notFound } from "next/navigation";
import { getPublicBoard, getPost, listComments } from "@/lib/api";
import { PostDetail } from "./post-detail";

// Post detay sayfası (Faz 2.4): apps/api'deki
// GET /public/:orgSlug/:boardSlug/posts/:postId[...] uçlarına karşılık gelir.
// Board yoksa/PRIVATE ise veya post o board'a ait değilse ikisi de aynı
// notFound() — apps/api tarafındaki "var ama başka board'un" bilgisini
// sızdırmama prensibinin (getPostDetail/getPublicBoard) frontend karşılığı.
export default async function Page(
  props: PageProps<"/[orgSlug]/[boardSlug]/[postId]">,
) {
  const { orgSlug, boardSlug, postId } = await props.params;

  const board = await getPublicBoard(orgSlug, boardSlug);
  if (!board) {
    notFound();
  }

  const post = await getPost(orgSlug, boardSlug, postId);
  if (!post) {
    notFound();
  }

  const comments = await listComments(orgSlug, boardSlug, postId);

  return (
    <PostDetail
      orgSlug={orgSlug}
      boardSlug={boardSlug}
      board={board}
      initialPost={post}
      initialComments={comments}
    />
  );
}
