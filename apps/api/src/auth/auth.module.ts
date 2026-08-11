import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PublicWidgetController } from './public-widget.controller';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

@Module({
  imports: [
    PassportModule,
    // JwtModule burada global secret/expiry vermiyoruz çünkü access ve
    // refresh token'lar farklı secret+süre kullanıyor; AuthService bunları
    // signAsync() çağrısında ayrı ayrı ConfigService'ten okuyor.
    JwtModule.register({}),
    // register() davet token'ı ile geldiğinde InvitationsService.redeemInvitation
    // çağırabilsin diye (bkz. AuthService.register); AuthService.identifyWidgetUser
    // de (4.3) OrganizationsService.getOrgWidgetSecret'a ihtiyaç duyuyor. Tek
    // yönlü bağımlılık: OrganizationsModule, AuthModule'e bağımlı değil —
    // döngüsel import yok.
    OrganizationsModule,
  ],
  // PublicWidgetController de burada: AuthService.identifyWidgetUser'ı
  // çağırıyor, ayrı bir modüle taşımak (ör. WidgetModule) AuthModule'e
  // bağımlı olurdu — OrganizationsModule zaten AuthModule'e bağımlı değil,
  // bu yüzden en basit çözüm PublicWidgetController'ı AuthModule'de tutmak
  // (bkz. dosyanın kendi başındaki route çakışması yorumu).
  controllers: [AuthController, PublicWidgetController],
  providers: [AuthService, JwtAccessStrategy, JwtRefreshStrategy],
  exports: [AuthService],
})
export class AuthModule {}
