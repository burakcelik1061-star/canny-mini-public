import { Module } from '@nestjs/common';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController, InvitationsController],
  // OrgMembershipGuard burada @UseGuards(OrgMembershipGuard) ile class
  // referansından kullanılıyor (bkz. OrganizationsController.invite) — Nest
  // bunu DI ile örnekleyebilsin diye bu modülün provider'ı olması gerekiyor.
  // Faz 2+'da Board/Post modülleri de aynı guard'ı kendi provider
  // listelerine ekleyecek (apps/api/src/common/guards altında, tek kaynak).
  providers: [OrganizationsService, InvitationsService, OrgMembershipGuard],
  // InvitationsService AuthModule'den de kullanılıyor (register + davet
  // token'ı akışı) — bu yüzden dışa açık.
  exports: [OrganizationsService, InvitationsService],
})
export class OrganizationsModule {}
