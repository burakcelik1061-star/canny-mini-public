import { Module } from '@nestjs/common';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  controllers: [TagsController],
  // OrgMembershipGuard, BoardsModule/PostsModule'daki aynı desen: @UseGuards
  // class referansından kullanıyor, DI ile örneklenebilmesi için provider.
  providers: [TagsService, OrgMembershipGuard],
  // PostsModule iki yerde kullanıyor: public board sayfasının tag filtre
  // listesi (GET /public/:orgSlug/:boardSlug/tags) ve post-tag atama/merge
  // (AdminPostsController) sırasında assertTagsBelongToOrg.
  exports: [TagsService],
})
export class TagsModule {}
