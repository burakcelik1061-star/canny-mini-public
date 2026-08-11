import { Module } from '@nestjs/common';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

@Module({
  controllers: [BoardsController],
  // OrgMembershipGuard, OrganizationsModule'daki ile aynı desen: class
  // referansından @UseGuards ile kullanıldığı için Nest'in DI ile
  // örnekleyebilmesi adına bu modülün de provider'ı olması gerekiyor.
  providers: [BoardsService, OrgMembershipGuard],
  // PostsModule, public board sayfası için BoardsService.getPublicBoard'ı
  // kullanıyor (bkz. posts/posts.module.ts).
  exports: [BoardsService],
})
export class BoardsModule {}
