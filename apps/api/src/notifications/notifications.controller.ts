import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { NotificationsService } from './notifications.service';

// Org-scoped DEĞİL — bildirimler kullanıcıya ait (widget identify'daki gibi
// bir org üyeliği gerektirmiyor), bu yüzden OrgMembershipGuard yok, sadece
// JwtAccessGuard. `markAsRead`'in kullanıcı izolasyonu route param'ında
// değil (`:orgId` yok) servis katmanında (`WHERE id AND userId`) sağlanıyor.
@UseGuards(JwtAccessGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.listForUser(user.sub);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notificationsService.markAsRead(user.sub, id);
  }

  // Statik `read-all` yolu `:id/read`'in altında DEĞİL, ayrı bir path
  // segment derinliğinde (`/notifications/read-all` vs
  // `/notifications/:id/read`) — Nest'in route eşleştirmesinde bir
  // çakışma riski yok (4.3'ün widget route-çakışması yorumundaki
  // "aynı derinlikte olsaydı kayıt sırasına bağlı kırılgan bir varsayım"
  // durumu burada söz konusu değil).
  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllRead(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.notificationsService.markAllAsRead(user.sub);
  }
}
