import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Board, Prisma } from '@prisma/client';
import { PlanLimitExceededException } from '../billing/plan-limit.exception';
import { PLAN_LIMITS } from '../billing/plan-limits';
import { slugify } from '../common/slugify';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  async createBoard(orgId: string, dto: CreateBoardDto): Promise<Board> {
    await this.assertWithinBoardLimit(orgId);

    const name = dto.name.trim();
    const slug = await this.generateUniqueSlug(orgId, name);

    try {
      return await this.prisma.board.create({
        data: { orgId, name, slug, visibility: dto.visibility },
      });
    } catch (error) {
      // generateUniqueSlug ile insert arasındaki (nadir) yarışa karşı DB'deki
      // @@unique([orgId, slug]) son savunma hattı — bkz.
      // OrganizationsService.createOrganization'daki aynı desen.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          'Bu isimle bir board az önce oluşturuldu, tekrar deneyin',
        );
      }
      throw error;
    }
  }

  async listBoards(orgId: string): Promise<Board[]> {
    return this.prisma.board.findMany({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getBoard(orgId: string, boardId: string): Promise<Board> {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
    });

    // board.orgId !== orgId durumunu da "bulunamadı" olarak dönüyoruz —
    // "var ama başka org'un" bilgisi bile sızdırılmamalı (OrgMembershipGuard'ın
    // amacıyla aynı izolasyon prensibi).
    if (!board || board.orgId !== orgId) {
      throw new NotFoundException('Board bulunamadı');
    }

    return board;
  }

  async updateBoard(
    orgId: string,
    boardId: string,
    dto: UpdateBoardDto,
  ): Promise<Board> {
    await this.getBoard(orgId, boardId); // varlık + org sahipliği doğrulaması

    const data: Prisma.BoardUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.visibility !== undefined) {
      data.visibility = dto.visibility;
    }

    return this.prisma.board.update({ where: { id: boardId }, data });
  }

  async deleteBoard(orgId: string, boardId: string): Promise<void> {
    await this.getBoard(orgId, boardId); // varlık + org sahipliği doğrulaması
    await this.prisma.board.delete({ where: { id: boardId } });
  }

  // 2.2'nin "herkese açık board sayfası" için: org/board üyeliği DEĞİL, org
  // ve board slug'larıyla (canny-mini.com/:orgSlug/:boardSlug public URL
  // deseni, bkz. Board.slug yorumu) bulur ve sadece PUBLIC board'ları döner.
  // PRIVATE bir board'a bu yoldan erişmeye çalışmak da, hiç var olmayan bir
  // board'a erişmeye çalışmak da aynı NotFoundException'ı verir — "var ama
  // private" bilgisi bile sızdırılmaz (getBoard'daki izolasyon prensibiyle
  // aynı). Auth gerektirmez: end-user org'a üye olmadan da board'u görebilir.
  async getPublicBoard(orgSlug: string, boardSlug: string): Promise<Board> {
    const organization = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
    });
    if (!organization) {
      throw new NotFoundException('Board bulunamadı');
    }

    const board = await this.prisma.board.findUnique({
      where: { orgId_slug: { orgId: organization.id, slug: boardSlug } },
    });
    if (!board || board.visibility !== 'PUBLIC') {
      throw new NotFoundException('Board bulunamadı');
    }

    return board;
  }

  private async generateUniqueSlug(
    orgId: string,
    name: string,
  ): Promise<string> {
    const base = slugify(name) || 'board';
    let candidate = base;
    let suffix = 2;

    while (
      await this.prisma.board.findUnique({
        where: { orgId_slug: { orgId, slug: candidate } },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  // Faz 6.2 — org sahipliği/varlığı bu noktaya gelmeden ÖNCE
  // OrgMembershipGuard tarafından zaten doğrulanmış (bkz. controller), bu
  // yüzden burada tekrar bir NotFoundException fırlatmıyoruz — `plan` +
  // mevcut board sayısını TEK sorguda (`_count`) çekip PLAN_LIMITS'e
  // karşı kontrol ediyoruz.
  private async assertWithinBoardLimit(orgId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { plan: true, _count: { select: { boards: true } } },
    });
    if (!org) {
      return;
    }

    const { maxBoards } = PLAN_LIMITS[org.plan];
    if (maxBoards !== null && org._count.boards >= maxBoards) {
      throw new PlanLimitExceededException(
        `Free plan en fazla ${maxBoards} board'a izin veriyor — daha fazla board için Pro'ya yükselt`,
      );
    }
  }
}
