import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

// Ayrı add/remove endpoint'leri yerine tek bir "replace" — admin UI'daki
// bir multi-select'in doğal davranışı zaten post'un TÜM tag'lerini
// gönderir (bkz. PostsService.setPostTags).
export class UpdatePostTagsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tagIds!: string[];
}
