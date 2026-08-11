import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Tag } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Faz 3.3: Tag org-scoped (0.1 doc'taki ER şemasındaki gibi bir board'a
// değil org'a ait) — board CRUD'daki (BoardsService) aynı izolasyon
// desenleri burada da geçerli: `orgId` her sorguda where'e giriyor,
// varlık kontrolü "var ama başka org'un" bilgisini bile sızdırmıyor.
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTag(orgId: string, dto: CreateTagDto): Promise<Tag> {
    const name = dto.name.trim();
    try {
      return await this.prisma.tag.create({
        data: { orgId, name, ...(dto.color ? { color: dto.color } : {}) },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('Bu isimde bir tag zaten var');
      }
      throw error;
    }
  }

  async listTags(orgId: string): Promise<Tag[]> {
    return this.prisma.tag.findMany({
      where: { orgId },
      orderBy: { name: 'asc' },
    });
  }

  // Public board sayfasının filtre çipleri için (GET /public/.../tags):
  // org'un TÜM tag'lerini değil, SADECE bu board'un (birleştirilmemiş)
  // post'larında gerçekten kullanılan tag'leri döner. Aksi halde yalnızca
  // PRIVATE board'larda kullanılan tag adları (ör. "enterprise-deal") de
  // anonim bir public board ziyaretçisine sızardı — tag'ler org-scoped ve
  // board'lar arası paylaşımlı olduğu için `listTags(orgId)` bunu ayırt etmez.
  async listTagsForBoard(boardId: string): Promise<Tag[]> {
    return this.prisma.tag.findMany({
      where: { posts: { some: { boardId, mergedIntoPostId: null } } },
      orderBy: { name: 'asc' },
    });
  }

  async deleteTag(orgId: string, tagId: string): Promise<void> {
    const tag = await this.prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag || tag.orgId !== orgId) {
      throw new NotFoundException('Tag bulunamadı');
    }
    await this.prisma.tag.delete({ where: { id: tagId } });
  }

  // Post-tag atama (3.3) için: verilen tagId'lerin GERÇEKTEN bu org'a ait
  // olduğunu doğrular — aksi halde başka bir org'un tag'i bir post'a
  // atanabilirdi (org-scoped izolasyon garantisinin tag tarafı).
  async assertTagsBelongToOrg(orgId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return;
    const count = await this.prisma.tag.count({
      where: { id: { in: tagIds }, orgId },
    });
    if (count !== new Set(tagIds).size) {
      throw new NotFoundException(
        'Bir veya daha fazla tag bulunamadı ya da bu organizasyona ait değil',
      );
    }
  }
}
