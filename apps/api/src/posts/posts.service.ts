import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Post, PostStatus, Prisma, Tag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';

export type PostSort = 'new' | 'top';

// authorId BİLİNÇLİ olarak dışarıda: bu şekil public uçlardan
// (GET /public/:orgSlug/:boardSlug/posts, anonim erişilebilir) dönüyor ve
// authorId dahili bir User id'si — dışarı verilmesi bir kullanıcı-envanteri
// (enumeration) sızıntısı olurdu. Sorgular `omit: { authorId: true }` ile
// alanı hiç çekmiyor (frontend zaten hiçbir yerde göstermiyor).
export type PostWithVotes = Omit<Post, 'authorId'> & {
  voteCount: number;
  hasVoted: boolean;
  tags: Tag[];
};

const OMIT_AUTHOR = { authorId: true } as const;

// Sayfalama: public board listesi (GET /public/.../posts) auth gerektirmiyor
// ve eskiden `take` YOKTU — binlerce post'lu bir board tek yanıtta dönebilir,
// her biri `tags` include ederdi (sınırsız yanıt = kolay bir DoS/bellek yükü).
// Varsayılan sayfa boyutu makul, üst sınır sert.
export const DEFAULT_POSTS_PAGE_SIZE = 50;
export const MAX_POSTS_PAGE_SIZE = 100;

function clampLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_POSTS_PAGE_SIZE;
  }
  return Math.min(Math.floor(limit), MAX_POSTS_PAGE_SIZE);
}

function clampOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset) || offset <= 0) {
    return 0;
  }
  return Math.floor(offset);
}

// Route'ta gelen ham bir query string'in (?status=...) geçerli bir
// PostStatus olup olmadığını kontrol etmek için — controller'daki kullanım
// aynı ?sort=top'taki gibi permissive: geçersiz/bilinmeyen bir değer sessizce
// "filtre yok" muamelesi görür, 400 fırlatılmaz.
export const POST_STATUSES: readonly PostStatus[] = [
  'UNDER_REVIEW',
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETE',
  'CLOSED',
];

export function isPostStatus(value: unknown): value is PostStatus {
  return (
    typeof value === 'string' &&
    (POST_STATUSES as readonly string[]).includes(value)
  );
}

const POST_LIST_INCLUDE = {
  _count: { select: { votes: true } },
  tags: true,
} satisfies Prisma.PostInclude;

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  // Yetki/varlık kontrolü (board gerçekten var mı, PUBLIC mi) çağıran
  // controller'da BoardsService.getPublicBoard ile zaten yapılmış oluyor —
  // burası board'un var olduğunu varsayar (OrganizationsController.invite'ın
  // OrgMembershipGuard'a güvenmesiyle aynı desen).
  //
  // PostWithVotes dönüyor (ham Post değil): apps/web'in NewPostForm'u
  // (board-page.tsx) bu response'u doğrudan local post listesine ekliyor
  // (onCreated) — 3.3'te PostList'e eklenen `post.tags.length` bu yüzden
  // ham bir Post'ta (tags/voteCount/hasVoted yok) çökerdi. Yeni bir post'un
  // 0 oyu/tag'i olduğu zaten kesin, ekstra bir sorguya gerek yok.
  async createPost(
    boardId: string,
    authorId: string,
    dto: CreatePostDto,
  ): Promise<PostWithVotes> {
    const post = await this.prisma.post.create({
      data: {
        boardId,
        authorId,
        title: dto.title.trim(),
        description: dto.description.trim(),
      },
      omit: OMIT_AUTHOR,
    });
    return { ...post, voteCount: 0, hasVoted: false, tags: [] };
  }

  async listPostsForBoard(
    boardId: string,
    options: {
      sort: PostSort;
      viewerUserId?: string;
      status?: PostStatus;
      search?: string;
      tagId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<PostWithVotes[]> {
    const where: Prisma.PostWhereInput = {
      boardId,
      // Birleştirilmiş (duplicate) post'lar (3.3) hiçbir listede kendi
      // başına bir kart olarak görünmez — hem public board listesinde hem
      // admin-posts.controller.ts'in kanban veri kaynağında. Post kaydı
      // silinmiyor (mergePost bkz.), sadece burada filtreleniyor.
      mergedIntoPostId: null,
      ...(options.status ? { status: options.status } : {}),
      // ?tag= (3.3), ?status'teki gibi tek bir filtre — 2.5'in "single
      // filter value" deseniyle tutarlı, AND/OR çoklu tag kombinasyonu bu
      // ölçekte gereksiz karmaşıklık olurdu.
      ...(options.tagId ? { tags: { some: { id: options.tagId } } } : {}),
      // Başlık/açıklama üzerinde basit, case-insensitive "contains" araması —
      // full-text search (ör. Postgres tsvector) MVP kapsamı dışında, tek bir
      // board'un post sayısı için de gereksiz bir karmaşıklık olurdu.
      ...(options.search
        ? {
            OR: [
              { title: { contains: options.search, mode: 'insensitive' } },
              {
                description: { contains: options.search, mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };

    const posts = await this.prisma.post.findMany({
      where,
      omit: OMIT_AUTHOR,
      include: POST_LIST_INCLUDE,
      // "top": en çok oydan aza, eşitlikte en yeni önce. "new" (varsayılan):
      // en yeniden en eskiye — Faz 2.3 öncesindeki tek davranış.
      orderBy:
        options.sort === 'top'
          ? [{ votes: { _count: 'desc' } }, { createdAt: 'desc' }]
          : { createdAt: 'desc' },
      // Sayfalama: limit sert bir üst sınıra kırpılıyor (bkz. clampLimit) —
      // dışarıdan gelen bir `?limit=999999` yanıtı sınırsızlaştıramaz.
      take: clampLimit(options.limit),
      skip: clampOffset(options.offset),
    });

    // Ayrı bir sorguyla çözülüyor: include'a koşullu bir `votes` filtresi
    // eklemek (viewerUserId yoksa hiç, varsa userId'ye göre) Prisma'nın tipini
    // ternary'ye göre değiştiremediği için tek tip bir dönüş şekli
    // (her zaman { _count }) tutup hasVoted'ı ayrıca hesaplamak daha temiz.
    let votedPostIds = new Set<string>();
    if (options.viewerUserId) {
      const votes = await this.prisma.vote.findMany({
        where: {
          postId: { in: posts.map((post) => post.id) },
          userId: options.viewerUserId,
        },
        select: { postId: true },
      });
      votedPostIds = new Set(votes.map((vote) => vote.postId));
    }

    return posts.map(({ _count, ...post }) => ({
      ...post,
      voteCount: _count.votes,
      hasVoted: votedPostIds.has(post.id),
    }));
  }

  // Post detay sayfası (2.4) için: listPostsForBoard'daki voteCount/hasVoted
  // hesaplamasının tekil post karşılığı. Board eşleşmezse (ör. başka bir
  // board'un post'u) NotFoundException — aynı sızdırmama prensibi. Merge
  // edilmiş bir post'a (3.3) doğrudan URL ile gitmek burada YASAKLANMIYOR —
  // listeden kaybolur ama link'i olan biri (ör. eski bir yer imi) yine
  // görebilir, sadece artık oy taşınmış olduğu için voteCount düşük olabilir.
  async getPostDetail(
    boardId: string,
    postId: string,
    viewerUserId?: string,
  ): Promise<PostWithVotes> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      omit: OMIT_AUTHOR,
      include: POST_LIST_INCLUDE,
    });
    if (!post || post.boardId !== boardId) {
      throw new NotFoundException('Post bulunamadı');
    }

    let hasVoted = false;
    if (viewerUserId) {
      const vote = await this.prisma.vote.findUnique({
        where: { postId_userId: { postId, userId: viewerUserId } },
      });
      hasVoted = vote !== null;
    }

    const { _count, ...rest } = post;
    return { ...rest, voteCount: _count.votes, hasVoted };
  }

  // Vote endpoint'lerinin isolation kontrolü için: postId, verilen board'a
  // ait değilse (ör. başka bir board'un post'u) "yok" muamelesi görür —
  // BoardsService.getBoard/getPublicBoard'daki aynı sızdırmama prensibi.
  async assertPostInBoard(boardId: string, postId: string): Promise<void> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { boardId: true },
    });
    if (!post || post.boardId !== boardId) {
      throw new NotFoundException('Post bulunamadı');
    }
  }

  // Roadmap kanban'ın (3.2) drag-drop'u: bir kartı bir kolondan diğerine
  // taşımak bu metodu çağırır. İzolasyon deseni assertPostInBoard'la aynı
  // (postId verilen board'a ait değilse "yok" muamelesi görür) ama burada
  // ayrı bir sorgu olarak yazıldı: eski status'ü de `select`e eklemek
  // (5.2'nin status-değişikliği bildirimi neyin değiştiğini bilmek zorunda)
  // ekstra bir sorguya gerek bırakmadan mümkün oldu — assertPostInBoard
  // sadece boardId seçiyor, onu çağırıp status için ikinci bir findUnique
  // atmak yerine tek sorguda ikisi de alınıyor.
  async updatePostStatus(
    boardId: string,
    postId: string,
    status: PostStatus,
  ): Promise<{ post: Post; previousStatus: PostStatus }> {
    const existing = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { boardId: true, status: true },
    });
    if (!existing || existing.boardId !== boardId) {
      throw new NotFoundException('Post bulunamadı');
    }
    const post = await this.prisma.post.update({
      where: { id: postId },
      data: { status },
    });
    return { post, previousStatus: existing.status };
  }

  // Etiket atama (3.3): verilen tagId listesi post'un YENİ tam tag kümesi —
  // ayrı add/remove endpoint'leri yerine tek bir "replace" (Prisma'nın
  // `set`'i) tercih edildi, admin UI'daki bir multi-select'in doğal
  // davranışı zaten bu (tüm seçili tag'leri gönder). tagId'lerin org'a ait
  // olduğu doğrulaması burada DEĞİL, çağıran controller'da
  // TagsService.assertTagsBelongToOrg ile yapılıyor (OrgMembershipGuard'ın
  // orgId'yi zaten doğrulamış olmasıyla aynı "tek doğrulama noktası" deseni).
  async setPostTags(
    boardId: string,
    postId: string,
    tagIds: string[],
  ): Promise<PostWithVotes> {
    await this.assertPostInBoard(boardId, postId);
    const post = await this.prisma.post.update({
      where: { id: postId },
      data: { tags: { set: tagIds.map((id) => ({ id })) } },
      omit: OMIT_AUTHOR,
      include: POST_LIST_INCLUDE,
    });
    const { _count, ...rest } = post;
    return { ...rest, voteCount: _count.votes, hasVoted: false };
  }

  // Duplicate merge (3.3): sourcePostId'yi targetPostId'ye "birleştirir".
  // Mimari Kararlar'daki karar: oy taşıma işlemi DB seviyesinde değil,
  // burada bir transaction ile app katmanında yapılır. Kurallar:
  // - İkisi de aynı board'a ait olmalı (assertPostInBoard, izolasyon).
  // - Kendi kendine merge anlamsız.
  // - Zaten merge edilmiş bir post'u kaynak/hedef olarak kullanmak
  //   yasak — zincirleme merge (A->B->C) modeli gereksiz karmaşıklaştırır,
  //   MVP kapsamı dışı.
  // - source'un oyları target'a taşınır; target'ta da aynı user'ın oyu
  //   varsa (iki post'a da oy vermiş kullanıcı) source'daki oy silinir
  //   (Vote'un @@unique([postId,userId]) kısıtına çarpmamak için) —
  //   "oylar toplanır" (prompt-library) burada voteCount'un ARTMASI değil,
  //   tekrar sayılmadan birleşmesi anlamına geliyor.
  async mergePost(
    boardId: string,
    sourcePostId: string,
    targetPostId: string,
  ): Promise<Post> {
    if (sourcePostId === targetPostId) {
      // Geçersiz istek (kaynak eksik değil) → 400, 404 değil.
      throw new BadRequestException('Bir post kendisiyle birleştirilemez');
    }

    return this.prisma.$transaction(async (tx) => {
      // Kaynak ve hedef post satırlarını FOR UPDATE ile KİLİTLE — okumadan
      // ÖNCE. Aksi halde iki eşzamanlı merge de source'u `mergedIntoPostId:
      // null` görüp oylarını farklı hedeflere bölebilir, son yazan
      // `mergedIntoPostId`'yi ezerdi (kolonda unique yok). Kilit alındıktan
      // sonra kaybeden transaction bekler, sonra source'u ARTIK merge edilmiş
      // görür ve aşağıdaki kontrolle reddedilir. ORDER BY id: iki transaction
      // da satırları aynı sırada kilitlesin (deadlock önleme).
      await tx.$queryRaw`
        SELECT id FROM posts
        WHERE id IN (${sourcePostId}, ${targetPostId})
        ORDER BY id
        FOR UPDATE
      `;

      const [source, target] = await Promise.all([
        tx.post.findUnique({ where: { id: sourcePostId } }),
        tx.post.findUnique({ where: { id: targetPostId } }),
      ]);

      if (!source || source.boardId !== boardId) {
        throw new NotFoundException('Post bulunamadı');
      }
      if (!target || target.boardId !== boardId) {
        throw new NotFoundException('Hedef post bulunamadı');
      }
      if (source.mergedIntoPostId || target.mergedIntoPostId) {
        // Post'lar VAR ama durumları merge'e uygun değil → 409 (durum
        // çakışması), 404 değil. Eşzamanlı ikinci merge de buraya düşer.
        throw new ConflictException(
          'Zaten birleştirilmiş bir post kaynak/hedef olarak kullanılamaz',
        );
      }

      const sourceVotes = await tx.vote.findMany({
        where: { postId: sourcePostId },
      });
      for (const vote of sourceVotes) {
        const targetHasVote = await tx.vote.findUnique({
          where: {
            postId_userId: { postId: targetPostId, userId: vote.userId },
          },
        });
        if (targetHasVote) {
          await tx.vote.delete({ where: { id: vote.id } });
        } else {
          await tx.vote.update({
            where: { id: vote.id },
            data: { postId: targetPostId },
          });
        }
      }

      return tx.post.update({
        where: { id: sourcePostId },
        data: { mergedIntoPostId: targetPostId },
      });
    });
  }
}
