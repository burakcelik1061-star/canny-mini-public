import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AUTH_THROTTLE } from '../common/throttler.constants';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import type { AuthTokens, JwtPayload } from './types/jwt-payload.type';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün — JWT_REFRESH_EXPIRES_IN ile aynı olmalı

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // Faz 7.4 — genel limitten (dakikada 120) belirgin şekilde dar: kayıt ve
  // giriş uçları kaba kuvvet/otomatik hesap açma denemelerinin ilk hedefi.
  @Throttle({ default: AUTH_THROTTLE })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.register(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { user, accessToken: tokens.accessToken };
  }

  @Throttle({ default: AUTH_THROTTLE })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.login(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { user, accessToken: tokens.accessToken };
  }

  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @CurrentUser() user: JwtPayload & { refreshToken: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens: AuthTokens = await this.authService.refreshTokens(
      user.sub,
      user.refreshToken,
    );
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @UseGuards(JwtAccessGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.sub);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/auth' });
    return { success: true };
  }

  @UseGuards(JwtAccessGuard)
  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    return this.authService.getSafeUserById(user.sub);
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    const isProd = this.configService.get('NODE_ENV') === 'production';
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true, // JS ile okunamaz — XSS ile çalınmasını zorlaştırır
      secure: isProd,
      // Local'de apps/web ve apps/api aynı "site" sayılır (ikisi de
      // localhost, farklı port) — 'lax' yeterli ve kullanılan tek yol bu.
      // 'none' + secure dalı, web ve api'nin FARKLI domain'lerde durduğu
      // (cross-site) bir kurulum için duruyor: orada tarayıcılar 'lax' bir
      // cookie'yi fetch/XHR'da göndermez, refresh isteği sessizce
      // cookie'siz gidip 401 alırdı. Proje şu an sadece local + GitHub
      //, yani bu dal bugün hiç
      // çalışmıyor — ileride bir gün ayrı domain'lere deploy edilirse
      // sessiz bir prod-only bug çıkmasın diye bilinçli olarak bırakıldı.
      sameSite: isProd ? 'none' : 'lax',
      path: '/auth', // sadece /auth/refresh ve /auth/logout'a gönderilsin
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }
}
