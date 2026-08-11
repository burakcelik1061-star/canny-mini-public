import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { JwtPayload } from '../types/jwt-payload.type';

const extractFromCookie = (req: Request): string | null => {
  return (req?.cookies?.refreshToken as string | undefined) ?? null;
};

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(configService: ConfigService) {
    super({
      // SADECE httpOnly cookie'den — refresh token'ın tasarım gereği yaşadığı
      // yer orası (bkz. AuthController.setRefreshCookie, path '/auth'). Eskiden
      // bir `Authorization: Bearer` fallback'i de vardı ama ÖLÜ koddu: validate
      // token'ı yalnızca cookie'den geri okuyor, dolayısıyla Bearer ile gelen
      // bir istek JWT imzasını geçse bile aşağıda boş bir refreshToken'la
      // hash-karşılaştırmasına düşüp kafa karıştırıcı bir şekilde reddediliyordu.
      jwtFromRequest: extractFromCookie,
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  // Refresh token'ın kendisini de req.user'a ekliyoruz — AuthService onu
  // DB'deki hash ile karşılaştırmak için kullanacak (rotation/revocation).
  // jwtFromRequest cookie-only olduğu için buraya gelindiğinde cookie kesin var.
  validate(
    req: Request,
    payload: JwtPayload,
  ): JwtPayload & { refreshToken: string } {
    const refreshToken = extractFromCookie(req) ?? '';
    return { ...payload, refreshToken };
  }
}
