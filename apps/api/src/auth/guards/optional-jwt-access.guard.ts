import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Post listesi herkese açık — token olmadan da çalışmalı — ama giriş
// yapılmışsa "bu post'a zaten oy verdim mi" (hasVoted) bilgisini de
// dönebilmek için kimliği bilmek istiyoruz. Normal JwtAccessGuard, token
// yoksa/geçersizse UnauthorizedException fırlatır; burada handleRequest
// override edilerek bu davranış kapatılıyor — token geçerliyse
// request.user dolar, değilse/hiç yoksa sessizce `false` kalır (route
// engellenmez). Route handler'lar CurrentUser'ı `JwtPayload | false` olarak
// tipleyip falsy kontrolü yapmalı.
@Injectable()
export class OptionalJwtAccessGuard extends AuthGuard('jwt-access') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return user;
  }
}
