import { IsString, MinLength } from 'class-validator';

export class MergePostDto {
  @IsString()
  @MinLength(1)
  targetPostId!: string;
}
