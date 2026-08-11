import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { BoardsService } from '../boards/boards.service';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { TagsService } from '../tags/tags.service';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { MergePostDto } from './dto/merge-post.dto';
import { UpdatePostStatusDto } from './dto/update-post-status.dto';
import { UpdatePostTagsDto } from './dto/update-post-tags.dto';
import { MAX_POSTS_PAGE_SIZE, PostsService } from './posts.service';

// Roadmap kanban'ın (3.2) veri kaynağı — public/:orgSlug/:boardSlug/posts'tan
// (2.2/2.5) farklı olarak org üyeliği gerektirir ve status/search
// filtresi yok: kanban tüm status'leri (CLOSED dahil, UI 4 kolonda
// gösterip filtreler) tek seferde ister. Board CRUD'daki aynı ayrım:
// listeleme her org üyesine açık, status değiştirme/tag atama/merge
// (3.2/3.3) OWNER|ADMIN'e kısıtlı.
@UseGuards(JwtAccessGuard, OrgMembershipGuard)
@Controller('organizations/:orgId/boards/:boardId/posts')
export class AdminPostsController {
  constructor(
    private readonly boardsService: BoardsService,
    private readonly postsService: PostsService,
    private readonly tagsService: TagsService,
    private readonly commentsService: CommentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get()
  async list(@Param('orgId') orgId: string, @Param('boardId') boardId: string) {
    const board = await this.boardsService.getBoard(orgId, boardId);
    // Kanban tüm status'leri tek seferde ister; yine de sınırsız değil —
    // sert üst sınır (MAX_POSTS_PAGE_SIZE) uygulanıyor (public listeyle aynı
    // koruma). Bu ölçekte tek board'un post sayısı bunun altında kalıyor.
    return this.postsService.listPostsForBoard(board.id, {
      sort: 'new',
      limit: MAX_POSTS_PAGE_SIZE,
    });
  }

  // 5.2: status GERÇEKTEN değiştiyse (aynı status'e "değiştirme" isteği
  // atılırsa — kanban'da teorik olarak mümkün değil ama API doğrudan
  // curl'lenebilir) gereksiz bir bildirim job'ı kuyruğa girmesin diye
  // previousStatus === yeni status karşılaştırması yapılıyor.
  @OrgRoles('OWNER', 'ADMIN')
  @Patch(':postId/status')
  async updateStatus(
    @Param('orgId') orgId: string,
    @Param('boardId') boardId: string,
    @Param('postId') postId: string,
    @Body() dto: UpdatePostStatusDto,
  ) {
    const board = await this.boardsService.getBoard(orgId, boardId);
    const { post, previousStatus } = await this.postsService.updatePostStatus(
      board.id,
      postId,
      dto.status,
    );
    if (previousStatus !== post.status) {
      await this.notificationsService.enqueueStatusChangeNotification(
        post.id,
        previousStatus,
        post.status,
      );
    }
    return post;
  }

  // Etiketleme (3.3): dto.tagIds post'un YENİ tam tag kümesi (bkz.
  // PostsService.setPostTags'in yorumu). assertTagsBelongToOrg burada
  // çağrılıyor — tagId'lerin bu org'a ait olduğu doğrulanmadan
  // setPostTags'e geçilseydi, başka bir org'un tag'i bir post'a
  // atanabilirdi (org-scoped izolasyon garantisinin tag tarafı).
  @OrgRoles('OWNER', 'ADMIN')
  @Patch(':postId/tags')
  async updateTags(
    @Param('orgId') orgId: string,
    @Param('boardId') boardId: string,
    @Param('postId') postId: string,
    @Body() dto: UpdatePostTagsDto,
  ) {
    const board = await this.boardsService.getBoard(orgId, boardId);
    await this.tagsService.assertTagsBelongToOrg(orgId, dto.tagIds);
    return this.postsService.setPostTags(board.id, postId, dto.tagIds);
  }

  // Duplicate merge (3.3): dto.targetPostId'ye ":postId"yi (kaynak/duplicate)
  // birleştirir — oy taşıma mantığı PostsService.mergePost'ta (bkz. o
  // metodun yorumu, Mimari Kararlar'daki "transaction ile app katmanında"
  // kararı).
  @OrgRoles('OWNER', 'ADMIN')
  @Post(':postId/merge')
  async merge(
    @Param('orgId') orgId: string,
    @Param('boardId') boardId: string,
    @Param('postId') postId: string,
    @Body() dto: MergePostDto,
  ) {
    const board = await this.boardsService.getBoard(orgId, boardId);
    return this.postsService.mergePost(board.id, postId, dto.targetPostId);
  }

  // Admin yanıtı (3.4): public/:orgSlug/:boardSlug/posts/:postId/comments'in
  // (2.4) org-scoped, OWNER|ADMIN'e kısıtlı karşılığı — tek farkı
  // isOfficial:true (CommentsService.createComment'in son argümanı).
  // Public post detay sayfası isOfficial=true olan yorumları zaten "Resmi
  // yanıt" rozetiyle gösteriyor (bkz. post-detail.tsx → CommentList,
  // 2.4'te eklenmişti ama işaretleme mekanizması şimdiye kadar yoktu).
  @OrgRoles('OWNER', 'ADMIN')
  @Post(':postId/comments')
  async createOfficialComment(
    @Param('orgId') orgId: string,
    @Param('boardId') boardId: string,
    @Param('postId') postId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCommentDto,
  ) {
    const board = await this.boardsService.getBoard(orgId, boardId);
    await this.postsService.assertPostInBoard(board.id, postId);
    return this.commentsService.createComment(postId, user.sub, dto, true);
  }
}
