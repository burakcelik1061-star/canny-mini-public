import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { InvitationsService } from './invitations.service';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  // Public: kullanıcı henüz kayıtlı olmayabilir — "X organizasyonuna Y
  // rolüyle davetlisin" önizlemesini register/login öncesi gösterebilmek için.
  @Get(':token')
  async preview(@Param('token') token: string) {
    return this.invitationsService.getByToken(token);
  }

  // Zaten giriş yapmış bir kullanıcı (yeni bir org'a davet edilmiş mevcut
  // kullanıcı) daveti kabul ediyor. Register sırasında kabul etme akışı
  // AuthService.register() içinde aynı InvitationsService.redeemInvitation'ı
  // kullanıyor — tek doğruluk kaynağı.
  @UseGuards(JwtAccessGuard)
  @Post(':token/accept')
  async accept(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    return this.invitationsService.redeemInvitation(token, {
      id: user.sub,
      email: user.email,
    });
  }
}
