import { BoardVisibility } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// PartialType(CreateBoardDto) kullanılmadı: apps/api'de @nestjs/mapped-types
// bağımlılığı yok (bkz. organizations/dto'daki DTO'lar da elle yazılmış) —
// bilinçli olarak minimal bağımlılık.
export class UpdateBoardDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(BoardVisibility)
  visibility?: BoardVisibility;
}
