import { Module } from '@nestjs/common';
import { BoardsModule } from '../boards/boards.module';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { TagsModule } from '../tags/tags.module';
import { AdminPostsController } from './admin-posts.controller';
import { CommentsService } from './comments.service';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { VotesService } from './votes.service';

@Module({
  // BoardsModule'ü import ediyoruz ki BoardsService (getPublicBoard/getBoard)
  // buraya DI ile enjekte edilebilsin — BoardsModule bunu zaten export ediyor.
  // TagsModule (3.3): public tag listesi (PostsController) ve post-tag
  // atama/merge sırasında assertTagsBelongToOrg (AdminPostsController) için.
  // NotificationsModule (5.2): status değişikliğinde bildirim job'ını
  // kuyruğa eklemek için AdminPostsController'a enjekte ediliyor.
  imports: [BoardsModule, TagsModule, NotificationsModule],
  controllers: [PostsController, AdminPostsController],
  // VotesService/CommentsService ayrı birer modül değil: Post'un sıkı bağlı
  // alt kaynakları (InvitationsService'in OrganizationsModule içinde
  // yaşamasıyla aynı desen), ayrı modüllere çıkarmak bu ölçekte gereksiz
  // bölme olurdu. OrgMembershipGuard burada da provider olarak lazım
  // (BoardsModule'daki aynı gerekçe: @UseGuards class referansından
  // kullanıyor, Nest'in DI ile örnekleyebilmesi için).
  providers: [PostsService, VotesService, CommentsService, OrgMembershipGuard],
})
export class PostsModule {}
