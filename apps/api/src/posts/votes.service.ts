import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class VotesService {
  constructor(private readonly prisma: PrismaService) {}

  // Post'un board'a ait olduğu kontrolü (isolation) controller'da
  // PostsService.assertPostInBoard ile zaten yapılmış oluyor — createPost'un
  // board'un varlığını controller'a bırakması ile aynı desen.
  async addVote(
    postId: string,
    userId: string,
  ): Promise<{ voteCount: number }> {
    try {
      // create + count AYNI transaction'da: dönen voteCount, eklenen oyu içeren
      // tutarlı bir snapshot'tan okunuyor (ikisi ayrı sorgu olduğunda araya
      // giren bir işlem sayacı kaydırabilirdi).
      return await this.prisma.$transaction(async (tx) => {
        await tx.vote.create({ data: { postId, userId } });
        return { voteCount: await tx.vote.count({ where: { postId } }) };
      });
    } catch (error) {
      // @@unique([postId, userId]) — "bir kullanıcı bir post'a sadece bir kez
      // oy verebilir" kısıtı burada devreye giriyor.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('Bu posta zaten oy verildi');
      }
      throw error;
    }
  }

  async removeVote(
    postId: string,
    userId: string,
  ): Promise<{ voteCount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.vote.deleteMany({
        where: { postId, userId },
      });
      if (count === 0) {
        throw new NotFoundException('Bu posta oy vermemişsin');
      }
      return { voteCount: await tx.vote.count({ where: { postId } }) };
    });
  }
}
