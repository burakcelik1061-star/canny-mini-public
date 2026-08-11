import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { CreateTagDto } from './dto/create-tag.dto';
import { TagsService } from './tags.service';

// Tag CRUD, BoardsController'daki aynı ayrım: listeleme her org üyesine
// açık, oluşturma/silme OWNER|ADMIN'e kısıtlı (0.1 doc'ta Admin rolünün
// tanımı "board/post/roadmap/tag yönetimi" içeriyor). Rename/update
// endpoint'i bilinçli olarak yok — 3.3'ün kapsamı "tag ekleyebilme",
// düzenleme ayrı bir ihtiyaç doğarsa eklenir (board'daki tam CRUD'un
// aksine burada minimal tutuldu).
@UseGuards(JwtAccessGuard, OrgMembershipGuard)
@Controller('organizations/:orgId/tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @OrgRoles('OWNER', 'ADMIN')
  @Post()
  async create(@Param('orgId') orgId: string, @Body() dto: CreateTagDto) {
    return this.tagsService.createTag(orgId, dto);
  }

  @Get()
  async list(@Param('orgId') orgId: string) {
    return this.tagsService.listTags(orgId);
  }

  @OrgRoles('OWNER', 'ADMIN')
  @Delete(':tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('orgId') orgId: string, @Param('tagId') tagId: string) {
    await this.tagsService.deleteTag(orgId, tagId);
  }
}
