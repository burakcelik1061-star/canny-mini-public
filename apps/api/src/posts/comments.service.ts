import { Injectable } from '@nestjs/common';
import { Comment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';

// authorId dışarıda: yorumlar public post detay sayfasından (anonim
// erişilebilir) dönüyor ve authorId dahili bir User id'si — post'lardaki
// (PostWithVotes) aynı gerekçe, kullanıcı-envanteri sızıntısını önlemek.
export type PublicComment = Omit<Comment, 'authorId'>;

const OMIT_AUTHOR = { authorId: true } as const;

@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  // Post'un board'a ait olduğu kontrolü (isolation) controller'da
  // PostsService.assertPostInBoard ile zaten yapılmış oluyor — VotesService
  // ile aynı desen. isOfficial varsayılan false: normal (public) yorum
  // akışı hiç geçmiyor, sadece admin yanıtı (3.4, AdminPostsController)
  // true veriyor — "resmi yanıt" bir moderasyon/rol kontrolü, burada değil
  // çağıran controller'da (OrgRoles('OWNER','ADMIN')) uygulanıyor.
  async createComment(
    postId: string,
    authorId: string,
    dto: CreateCommentDto,
    isOfficial = false,
  ): Promise<PublicComment> {
    return this.prisma.comment.create({
      data: { postId, authorId, body: dto.body.trim(), isOfficial },
      omit: OMIT_AUTHOR,
    });
  }

  async listCommentsForPost(postId: string): Promise<PublicComment[]> {
    // Flat liste, kronolojik sırayla — threading MVP'de yok.
    return this.prisma.comment.findMany({
      where: { postId },
      omit: OMIT_AUTHOR,
      orderBy: { createdAt: 'asc' },
    });
  }
}
