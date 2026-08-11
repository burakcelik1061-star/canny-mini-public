import { BoardVisibility } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBoardDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  // Belirtilmezse şema tarafındaki @default(PUBLIC) devreye girer — Canny'de
  // olduğu gibi bir feedback board'unun asıl amacı görünür olmak.
  @IsOptional()
  @IsEnum(BoardVisibility)
  visibility?: BoardVisibility;
}
