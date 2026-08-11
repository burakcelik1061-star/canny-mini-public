import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, resetDatabase } from './integration-app';
import { createBoard, createOrg, createPost, registerUser } from './fixtures';
import type { TestOrg, TestUser } from './fixtures';

// Faz "izolasyon sertleştirme" — public (anonim erişilebilir) uçların hangi
// alanları döndürdüğünü sabitler:
//   - authorId (dahili User id'si) HİÇBİR public post/comment yanıtında
//     olmamalı (kullanıcı-envanteri sızıntısı),
//   - public board'un tag filtresi SADECE o board'da kullanılan tag'leri
//     döndürmeli (başka/PRIVATE board'ların tag adları sızmamalı).
describe('Public veri sızıntısı (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  let user: TestUser;
  let org: TestOrg;

  beforeAll(async () => {
    ({ app, prisma } = await createIntegrationApp());
    http = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    user = await registerUser(app);
    org = await createOrg(prisma, { ownerId: user.id });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authorId public yanıtlarda dönmez', () => {
    it('post listesi ve detayı authorId içermez, yorumlar da', async () => {
      const board = await createBoard(prisma, org.id, { visibility: 'PUBLIC' });
      const post = await createPost(prisma, board.id, user.id);
      await prisma.comment.create({
        data: { postId: post.id, authorId: user.id, body: 'Bir yorum' },
      });

      const list = await request(http)
        .get(`/public/${org.slug}/${board.slug}/posts`)
        .expect(200);
      const posts = list.body as Record<string, unknown>[];
      expect(posts).toHaveLength(1);
      expect(posts[0]).not.toHaveProperty('authorId');
      // Gösterilmesi gereken alanlar hâlâ var (sadece authorId gitti).
      expect(posts[0]).toHaveProperty('title');
      expect(posts[0]).toHaveProperty('voteCount');

      const detail = await request(http)
        .get(`/public/${org.slug}/${board.slug}/posts/${post.id}`)
        .expect(200);
      expect(detail.body as Record<string, unknown>).not.toHaveProperty(
        'authorId',
      );

      const commentsRes = await request(http)
        .get(`/public/${org.slug}/${board.slug}/posts/${post.id}/comments`)
        .expect(200);
      const comments = commentsRes.body as Record<string, unknown>[];
      expect(comments).toHaveLength(1);
      expect(comments[0]).not.toHaveProperty('authorId');
      expect(comments[0]).toHaveProperty('body', 'Bir yorum');
    });
  });

  describe('public tag filtresi board-scoped', () => {
    it('sadece bu board’da kullanılan tag’leri döner, PRIVATE board’unkini değil', async () => {
      const publicBoard = await createBoard(prisma, org.id, {
        visibility: 'PUBLIC',
      });
      const privateBoard = await createBoard(prisma, org.id, {
        visibility: 'PRIVATE',
      });

      const publicPost = await createPost(prisma, publicBoard.id, user.id);
      const privatePost = await createPost(prisma, privateBoard.id, user.id);

      const shownTag = await prisma.tag.create({
        data: { orgId: org.id, name: 'public-feature' },
      });
      const secretTag = await prisma.tag.create({
        data: { orgId: org.id, name: 'enterprise-deal' },
      });

      await prisma.post.update({
        where: { id: publicPost.id },
        data: { tags: { connect: { id: shownTag.id } } },
      });
      await prisma.post.update({
        where: { id: privatePost.id },
        data: { tags: { connect: { id: secretTag.id } } },
      });

      const response = await request(http)
        .get(`/public/${org.slug}/${publicBoard.slug}/tags`)
        .expect(200);

      const names = (response.body as { name: string }[]).map((t) => t.name);
      expect(names).toEqual(['public-feature']);
      expect(names).not.toContain('enterprise-deal');
    });
  });
});
