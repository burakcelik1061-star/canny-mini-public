import { PostStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

// Roadmap kanban'ın (3.2) drag-drop'unun backend karşılığı — bir kolondan
// diğerine taşınan kartın yeni status'ü. class-validator @IsEnum ile
// PostStatus dışında bir değer 400 ile reddedilir (public tarafındaki
// ?status= filtresinin permissive'liğinin aksine: burası bir yazma işlemi,
// geçersiz bir status'ü sessizce yok saymak yerine hata dönmeli).
export class UpdatePostStatusDto {
  @IsEnum(PostStatus)
  status!: PostStatus;
}
