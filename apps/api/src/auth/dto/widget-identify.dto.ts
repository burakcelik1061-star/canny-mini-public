import {
  IsEmail,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Host'un KENDİ backend'inin ürettiği imzalı payload — bkz.
// AuthService.identifyWidgetUser. `timestamp` host'un imzaladığı anın Unix
// ms'i (replay koruması: AuthService bunun şimdiki zamana yakın olduğunu
// ayrıca kontrol ediyor, DTO seviyesinde sadece "bir tamsayı" doğrulanıyor).
// `signature`, hex-encoded HMAC-SHA256 — 64 hex karakter (32 byte) sabit
// uzunluk.
export class WidgetIdentifyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsInt()
  timestamp!: number;

  @Matches(/^[0-9a-f]{64}$/, {
    message: 'signature 64 karakterlik hex-encoded bir HMAC-SHA256 olmalı',
  })
  signature!: string;
}
