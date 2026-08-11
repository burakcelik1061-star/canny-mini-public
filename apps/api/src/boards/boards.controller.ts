import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';

// Board CRUD tamamen org-scoped: OrgMembershipGuard, :orgId'nin gerçekten
// giriş yapmış kullanıcının üye olduğu bir org olduğunu garanti eder (bkz.
// common/guards/org-membership.guard.ts). Listeleme/görüntüleme her üyeye
// açık; oluşturma/güncelleme/silme OWNER|ADMIN ile sınırlı — MEMBER'lar
// board'ları görebilir ama yönetemez (2.4'teki yorum/oy akışlarıyla aynı
// "end-user vs admin" ayrımının org-içi karşılığı).
@UseGuards(JwtAccessGuard, OrgMembershipGuard)
@Controller('organizations/:orgId/boards')
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @OrgRoles('OWNER', 'ADMIN')
  @Post()
  async create(@Param('orgId') orgId: string, @Body() dto: CreateBoardDto) {
    return this.boardsService.createBoard(orgId, dto);
  }

  @Get()
  async list(@Param('orgId') orgId: string) {
    return this.boardsService.listBoards(orgId);
  }

  @Get(':boardId')
  async get(@Param('orgId') orgId: string, @Param('boardId') boardId: string) {
    return this.boardsService.getBoard(orgId, boardId);
  }

  @OrgRoles('OWNER', 'ADMIN')
  @Patch(':boardId')
  async update(
    @Param('orgId') orgId: string,
    @Param('boardId') boardId: string,
    @Body() dto: UpdateBoardDto,
  ) {
    return this.boardsService.updateBoard(orgId, boardId, dto);
  }

  @OrgRoles('OWNER', 'ADMIN')
  @Delete(':boardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('orgId') orgId: string,
    @Param('boardId') boardId: string,
  ) {
    await this.boardsService.deleteBoard(orgId, boardId);
  }
}
