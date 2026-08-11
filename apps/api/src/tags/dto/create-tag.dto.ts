import {
  IsHexColor,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  // Belirtilmezse şema tarafındaki @default("#71717a") devreye girer —
  // CreateBoardDto'daki visibility ile aynı desen.
  @IsOptional()
  @IsHexColor()
  color?: string;
}
