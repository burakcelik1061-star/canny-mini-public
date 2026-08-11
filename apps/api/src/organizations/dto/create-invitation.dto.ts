import { IsEmail, IsIn } from 'class-validator';

// OWNER davetle atanmaz (org başına tek OWNER, org oluşturulurken atanır) —
// bu yüzden burada sadece ADMIN|MEMBER kabul ediliyor.
const INVITABLE_ROLES = ['ADMIN', 'MEMBER'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsIn(INVITABLE_ROLES)
  role!: InvitableRole;
}
