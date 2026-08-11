import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  // Basit bir minimum güvenlik önlemi; MVP kapsamında karmaşıklık kuralı
  // (özel karakter zorunluluğu vb.) uygulanmıyor.
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt 72 byte'tan sonrasını sessizce kırpar, girdiyi baştan sınırlıyoruz
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  // Davet linkinden ("/invitations/:token") register oluyorsa: hesap
  // oluşturulur oluşturulmaz aynı akışta davet kabul edilir (bkz.
  // AuthService.register + InvitationsService.redeemInvitation).
  @IsOptional()
  @IsString()
  invitationToken?: string;
}
