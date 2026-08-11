import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, resetDatabase } from './integration-app';
import { createBoard, createOrg, createPost, registerUser } from './fixtures';
import type { TestUser } from './fixtures';

// Faz 7.1 — oylama. votes.service.spec.ts (unit) "Prisma P2002 fırlatırsa
// ConflictException'a çevriliyor mu"yu test ediyor; o testin
// kanıtLAYAMADIĞI şey, P2002'nin gerçekten fırlatılıp fırlatılmadığı — yani
// @@unique([postId, userId]) kısıtının şemada GERÇEKTEN var olması. Kısıt
// yanlışlıkla silinse unit testler yeşil kalır, buradakiler kırmızıya döner.

describe('Voting (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  let voter: TestUser;
  let orgSlug: string;
  let boardSlug: string;
  let boardId: string;
  let postId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createIntegrationApp());
    http = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await resetDatabase(prisma);

    voter = await registerUser(app);
    const org = await createOrg(prisma, { ownerId: voter.id });
    const board = await createBoard(prisma, org.id);
    const post = await createPost(prisma, board.id, voter.id);

    orgSlug = org.slug;
    boardSlug = board.slug;
    boardId = board.id;
    postId = post.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const votePath = () =>
    `/public/${orgSlug}/${boardSlug}/posts/${postId}/votes`;

  describe('POST .../votes', () => {
    it('oy verir, voteCount döner ve DB’ye gerçekten bir satır yazar', async () => {
      const response = await request(http)
        .post(votePath())
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(200);

      expect(response.body).toEqual({ postId, voteCount: 1, hasVoted: true });
      expect(await prisma.vote.count({ where: { postId } })).toBe(1);
    });

    // "Bir kullanıcı bir post'a sadece bir kez oy verebilir" kuralının
    // gerçek kanıtı — burada devreye giren şey servis kodu değil, DB'nin
    // kendi unique index'i.
    it('aynı kullanıcı ikinci kez oy veremez (409) ve sayaç artmaz', async () => {
      await request(http)
        .post(votePath())
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(200);

      await request(http)
        .post(votePath())
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(409);

      expect(await prisma.vote.count({ where: { postId } })).toBe(1);
    });

    it('farklı kullanıcılar aynı post’a oy verebilir', async () => {
      const other = await registerUser(app);

      await request(http)
        .post(votePath())
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(200);

      const second = await request(http)
        .post(votePath())
        .set('Authorization', `Bearer ${other.accessToken}`)
        .expect(200);

      expect((second.body as { voteCount: number }).voteCount).toBe(2);
      expect(await prisma.vote.count({ where: { postId } })).toBe(2);
    });

    it('giriş yapılmadan oy verilemez (401) ve hiç oy oluşmaz', async () => {
      await request(http).post(votePath()).expect(401);
      expect(await prisma.vote.count()).toBe(0);
    });
  });

  describe('DELETE .../votes', () => {
    it('oyu geri çeker ve güncel sayacı döner', async () => {
      await request(http)
        .post(votePath())
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(200);

      const response = await request(http)
        .delete(votePath())
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(200);

      expect(response.body).toEqual({ postId, voteCount: 0, hasVoted: false });
      expect(await prisma.vote.count({ where: { postId } })).toBe(0);
    });

    it('oy vermemiş bir kullanıcı geri çekemez (404)', async () => {
      await request(http)
        .delete(votePath())
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(404);
    });

    it('başka bir kullanıcının oyunu geri çekemez', async () => {
      const other = await registerUser(app);

      await request(http)
        .post(votePath())
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(200);

      // `other` hiç oy vermedi — deleteMany WHERE postId AND userId hiçbir
      // satır bulamamalı, voter'ın oyu yerinde kalmalı.
      await request(http)
        .delete(votePath())
        .set('Authorization', `Bearer ${other.accessToken}`)
        .expect(404);

      expect(await prisma.vote.count({ where: { postId } })).toBe(1);
    });
  });

  // Org-scoped izolasyon, "Kurallar"daki "her yeni endpoint'te kontrol
  // edilir" maddesinin oy uçları için karşılığı.
  describe('izolasyon', () => {
    it('başka bir org’un slug’ıyla aynı post’a oy verilemez (404)', async () => {
      const otherOrg = await createOrg(prisma);
      await createBoard(prisma, otherOrg.id, { slug: boardSlug });

      await request(http)
        .post(`/public/${otherOrg.slug}/${boardSlug}/posts/${postId}/votes`)
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(404);

      expect(await prisma.vote.count()).toBe(0);
    });

    it('PRIVATE board’daki post’a public uçtan oy verilemez (404)', async () => {
      const org = await createOrg(prisma, { ownerId: voter.id });
      const board = await createBoard(prisma, org.id, {
        visibility: 'PRIVATE',
      });
      const post = await createPost(prisma, board.id, voter.id);

      await request(http)
        .post(`/public/${org.slug}/${board.slug}/posts/${post.id}/votes`)
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(404);
    });

    it('var olmayan post id’si 404 döner', async () => {
      await request(http)
        .post(
          `/public/${orgSlug}/${boardSlug}/posts/00000000-0000-0000-0000-000000000000/votes`,
        )
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(404);
    });
  });

  describe('liste üzerindeki etkisi', () => {
    it('hasVoted sadece oy veren kullanıcı için true döner, anonim istekte false', async () => {
      const other = await registerUser(app);
      await request(http)
        .post(votePath())
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(200);

      const listPath = `/public/${orgSlug}/${boardSlug}/posts`;

      const asVoter = await request(http)
        .get(listPath)
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .expect(200);
      expect((asVoter.body as { hasVoted: boolean }[])[0].hasVoted).toBe(true);

      const asOther = await request(http)
        .get(listPath)
        .set('Authorization', `Bearer ${other.accessToken}`)
        .expect(200);
      expect((asOther.body as { hasVoted: boolean }[])[0].hasVoted).toBe(false);

      // OptionalJwtAccessGuard: token yoksa route yine çalışır (401 değil).
      const anonymous = await request(http).get(listPath).expect(200);
      expect((anonymous.body as { hasVoted: boolean }[])[0].hasVoted).toBe(
        false,
      );
    });

    it('?sort=top oy sayısına göre azalan sıralar', async () => {
      const popular = await createPost(prisma, boardId, voter.id, {
        title: 'Popüler',
      });
      const other = await registerUser(app);

      for (const user of [voter, other]) {
        await request(http)
          .post(`/public/${orgSlug}/${boardSlug}/posts/${popular.id}/votes`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);
      }

      const response = await request(http)
        .get(`/public/${orgSlug}/${boardSlug}/posts?sort=top`)
        .expect(200);

      const posts = response.body as { id: string; voteCount: number }[];
      expect(posts[0].id).toBe(popular.id);
      expect(posts[0].voteCount).toBe(2);
    });
  });

  // Şemadaki onDelete: Cascade davranışının kanıtı — mock'lanmış bir Prisma
  // ile test edilmesi mümkün olmayan, tamamen DB'ye ait bir garanti.
  it('post silinince oyları da silinir (cascade)', async () => {
    await request(http)
      .post(votePath())
      .set('Authorization', `Bearer ${voter.accessToken}`)
      .expect(200);

    await prisma.post.delete({ where: { id: postId } });

    expect(await prisma.vote.count({ where: { postId } })).toBe(0);
  });
});
