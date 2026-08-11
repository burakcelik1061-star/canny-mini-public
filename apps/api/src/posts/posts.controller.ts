import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { OptionalJwtAccessGuard } from '../auth/guards/optional-jwt-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { BoardsService } from '../boards/boards.service';
import { TagsService } from '../tags/tags.service';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { isPostStatus, PostsService } from './posts.service';
import { VotesService } from './votes.service';

// Query string'ten gelen ham `?limit`/`?offset` için — geçerli bir pozitif
// tamsayı değilse undefined döner (servis o zaman varsayılanı kullanır).
// Sert üst sınır servis katmanında (clampLimit) uygulanıyor.
function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

// Herkese açık board sayfası (2.2/2.3): org/board üyeliği gerekmez — herhangi
// bir giriş yapmış User "end-user" olarak post açabilir/oy verebilir. Board'un
// varlığı + PUBLIC olması her route'ta BoardsService.getPublicBoard ile
// ayrıca doğrulanıyor — bu da OrgMembershipGuard'ın "tek doğrulama noktası"
// prensibinin org-dışı karşılığı.
@Controller('public/:orgSlug/:boardSlug')
export class PostsController {
  constructor(
    private readonly boardsService: BoardsService,
    private readonly postsService: PostsService,
    private readonly votesService: VotesService,
    private readonly commentsService: CommentsService,
    private readonly tagsService: TagsService,
  ) {}

  @Get()
  async getBoard(
    @Param('orgSlug') orgSlug: string,
    @Param('boardSlug') boardSlug: string,
  ) {
    return this.boardsService.getPublicBoard(orgSlug, boardSlug);
  }

  // Board sayfasındaki tag filtresi (3.3) için — status pill'leriyle aynı
  // amaç: hangi değerlerin filtrelenebilir olduğunu göstermek. SADECE bu
  // board'un post'larında kullanılan tag'ler döner (org'un tümü değil) —
  // aksi halde başka (ör. PRIVATE) board'ların tag adları da public
  // ziyaretçiye sızardı (bkz. TagsService.listTagsForBoard).
  @Get('tags')
  async listBoardTags(
    @Param('orgSlug') orgSlug: string,
    @Param('boardSlug') boardSlug: string,
  ) {
    const board = await this.boardsService.getPublicBoard(orgSlug, boardSlug);
    return this.tagsService.listTagsForBoard(board.id);
  }

  // Auth zorunlu değil (OptionalJwtAccessGuard) — ama giriş yapılmışsa
  // dönen post'larda hasVoted doğru işaretlenir. ?sort=top ile en çok oydan
  // aza sıralanır, aksi halde en yeni önce (2.2'deki varsayılan davranış).
  // ?status=, ?search= (2.5) ve ?tag= (3.3) aynı permissive mantıkla:
  // geçersiz/boş değerler sessizce yok sayılır, 400 fırlatılmaz.
  @UseGuards(OptionalJwtAccessGuard)
  @Get('posts')
  async listPosts(
    @Param('orgSlug') orgSlug: string,
    @Param('boardSlug') boardSlug: string,
    @Query('sort') sort: string | undefined,
    @Query('status') status: string | undefined,
    @Query('search') search: string | undefined,
    @Query('tag') tag: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @CurrentUser() user: JwtPayload | false,
  ) {
    const board = await this.boardsService.getPublicBoard(orgSlug, boardSlug);
    return this.postsService.listPostsForBoard(board.id, {
      sort: sort === 'top' ? 'top' : 'new',
      viewerUserId: user ? user.sub : undefined,
      status: isPostStatus(status) ? status : undefined,
      search: search?.trim() || undefined,
      tagId: tag?.trim() || undefined,
      // Permissive: geçersiz/eksik değer varsayılana düşer (diğer filtrelerle
      // aynı desen). Servis limiti ayrıca sert bir üst sınıra kırpıyor.
      limit: parsePositiveInt(limit),
      offset: parsePositiveInt(offset),
    });
  }

  // Post oluşturmak org üyeliği DEĞİL, sadece giriş yapmış olmayı gerektirir
  // — OrgMembershipGuard burada bilinçli olarak kullanılmıyor.
  @UseGuards(JwtAccessGuard)
  @Post('posts')
  async createPost(
    @Param('orgSlug') orgSlug: string,
    @Param('boardSlug') boardSlug: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePostDto,
  ) {
    const board = await this.boardsService.getPublicBoard(orgSlug, boardSlug);
    return this.postsService.createPost(board.id, user.sub, dto);
  }

  // Post detay sayfası (2.4): tekil post + voteCount/hasVoted, listPosts ile
  // aynı OptionalJwtAccessGuard mantığı.
  @UseGuards(OptionalJwtAccessGuard)
  @Get('posts/:postId')
  async getPost(
    @Param('orgSlug') orgSlug: string,
    @Param('boardSlug') boardSlug: string,
    @Param('postId') postId: string,
    @CurrentUser() user: JwtPayload | false,
  ) {
    const board = await this.boardsService.getPublicBoard(orgSlug, boardSlug);
    return this.postsService.getPostDetail(
      board.id,
      postId,
      user ? user.sub : undefined,
    );
  }

  @Get('posts/:postId/comments')
  async listComments(
    @Param('orgSlug') orgSlug: string,
    @Param('boardSlug') boardSlug: string,
    @Param('postId') postId: string,
  ) {
    const board = await this.boardsService.getPublicBoard(orgSlug, boardSlug);
    await this.postsService.assertPostInBoard(board.id, postId);
    return this.commentsService.listCommentsForPost(postId);
  }

  // Yorum yazmak da post/oy vermek gibi org üyeliği DEĞİL, sadece giriş
  // yapmış olmayı gerektirir.
  @UseGuards(JwtAccessGuard)
  @Post('posts/:postId/comments')
  async createComment(
    @Param('orgSlug') orgSlug: string,
    @Param('boardSlug') boardSlug: string,
    @Param('postId') postId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCommentDto,
  ) {
    const board = await this.boardsService.getPublicBoard(orgSlug, boardSlug);
    await this.postsService.assertPostInBoard(board.id, postId);
    return this.commentsService.createComment(postId, user.sub, dto);
  }

  @UseGuards(JwtAccessGuard)
  @Post('posts/:postId/votes')
  @HttpCode(HttpStatus.OK)
  async addVote(
    @Param('orgSlug') orgSlug: string,
    @Param('boardSlug') boardSlug: string,
    @Param('postId') postId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const board = await this.boardsService.getPublicBoard(orgSlug, boardSlug);
    await this.postsService.assertPostInBoard(board.id, postId);
    const { voteCount } = await this.votesService.addVote(postId, user.sub);
    return { postId, voteCount, hasVoted: true };
  }

  @UseGuards(JwtAccessGuard)
  @Delete('posts/:postId/votes')
  async removeVote(
    @Param('orgSlug') orgSlug: string,
    @Param('boardSlug') boardSlug: string,
    @Param('postId') postId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const board = await this.boardsService.getPublicBoard(orgSlug, boardSlug);
    await this.postsService.assertPostInBoard(board.id, postId);
    const { voteCount } = await this.votesService.removeVote(postId, user.sub);
    return { postId, voteCount, hasVoted: false };
  }
}
