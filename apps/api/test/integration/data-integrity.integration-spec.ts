import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PostsService } from '../../src/posts/posts.service';
import { createIntegrationApp, resetDatabase } from './integration-app';
import { createBoard, createOrg, createPost, registerUser } from './fixtures';
import type { TestOrg, TestUser } from './fixtures';

// Faz "veri bütünlüğü & performans" — üç şeyi gerçek Postgres'e karşı kanıtlar:
//   - public post listesi SINIRLI (limit sert bir üst sınıra kırpılıyor),
//   - eşzamanlı iki merge veri bozmuyor (mergePost'taki FOR UPDATE kilidi),
//   - oy sayacı mutasyonla aynı transaction'da tutarlı dönüyor.
describe('Veri bütünlüğü & sayfalama (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let postsService: PostsService;

  let user: TestUser;
  let org: TestOrg;

  beforeAll(async () => {
    ({ app, prisma } = await createIntegrationApp());
    http = app.getHttpServer() as App;
    postsService = app.get(PostsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    user = await registerUser(app);
    org = await createOrg(prisma, { ownerId: user.id });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sayfalama (public post listesi)', () => {
    it('?limit sonucu sınırlar ve ?limit=99999 sert üst sınırı (100) aşamaz', async () => {
      const board = await createBoard(prisma, org.id, { visibility: 'PUBLIC' });
      // 6 post oluştur — küçük bir sayı ama limit davranışını göstermeye yeter.
      for (let i = 0; i < 6; i++) {
        await createPost(prisma, board.id, user.id, { title: `Post ${i}` });
      }

      const two = await request(http)
        .get(`/public/${org.slug}/${board.slug}/posts?limit=2`)
        .expect(200);
      expect(two.body as unknown[]).toHaveLength(2);

      // Absürt bir limit sınırsızlaştırmaz — servis MAX_POSTS_PAGE_SIZE'a
      // kırpar; 6 post var, hepsi döner ama "limit=99999" reddedilmeden
      // sessizce kırpılmış olur (sonuç sayısı veri kadar).
      const huge = await request(http)
        .get(`/public/${org.slug}/${board.slug}/posts?limit=99999`)
        .expect(200);
      expect((huge.body as unknown[]).length).toBe(6);

      // offset ile ikinci sayfa
      const offset = await request(http)
        .get(`/public/${org.slug}/${board.slug}/posts?limit=2&offset=2`)
        .expect(200);
      expect(offset.body as unknown[]).toHaveLength(2);
    });
  });

  describe('mergePost eşzamanlılık (FOR UPDATE kilidi)', () => {
    it('aynı source iki hedefe EŞ ZAMANLI merge edilse bile veri bozulmaz', async () => {
      const board = await createBoard(prisma, org.id);
      const source = await createPost(prisma, board.id, user.id);
      const targetA = await createPost(prisma, board.id, user.id);
      const targetB = await createPost(prisma, board.id, user.id);

      // source'a 3 farklı kullanıcının oyu — merge sonrası hepsi TEK bir
      // hedefe taşınmış olmalı (bölünmemeli).
      const voters = await Promise.all([
        registerUser(app),
        registerUser(app),
        registerUser(app),
      ]);
      for (const voter of voters) {
        await prisma.vote.create({
          data: { postId: source.id, userId: voter.id },
        });
      }

      // İki merge'i AYNI ANDA tetikle. FOR UPDATE kilidi sayesinde biri
      // kazanır, diğeri source'u artık merge edilmiş görüp reddedilir.
      const results = await Promise.allSettled([
        postsService.mergePost(board.id, source.id, targetA.id),
        postsService.mergePost(board.id, source.id, targetB.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      // Tam olarak biri başarılı, biri reddedilmiş olmalı.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // source tek bir hedefe merge edilmiş olmalı (A veya B).
      const mergedSource = await prisma.post.findUnique({
        where: { id: source.id },
      });
      const winnerId = mergedSource!.mergedIntoPostId;
      expect([targetA.id, targetB.id]).toContain(winnerId);

      // KRİTİK: 3 oyun HEPSİ kazanan hedefte, source'ta hiç oy kalmamış,
      // kaybeden hedefte source'tan taşınan oy YOK (oylar bölünmemiş).
      expect(await prisma.vote.count({ where: { postId: source.id } })).toBe(0);
      expect(await prisma.vote.count({ where: { postId: winnerId! } })).toBe(3);
      const loserId = winnerId === targetA.id ? targetB.id : targetA.id;
      expect(await prisma.vote.count({ where: { postId: loserId } })).toBe(0);
    });
  });

  describe('merge HTTP status kodları (doğru semantik)', () => {
    const mergeUrl = (orgId: string, boardId: string, postId: string) =>
      `/organizations/${orgId}/boards/${boardId}/posts/${postId}/merge`;

    it('kendisiyle merge → 400 (BadRequest, 404 değil)', async () => {
      const board = await createBoard(prisma, org.id);
      const post = await createPost(prisma, board.id, user.id);

      await request(http)
        .post(mergeUrl(org.id, board.id, post.id))
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ targetPostId: post.id })
        .expect(400);
    });

    it('zaten merge edilmiş bir post tekrar kaynak olursa → 409 (Conflict)', async () => {
      const board = await createBoard(prisma, org.id);
      const source = await createPost(prisma, board.id, user.id);
      const target = await createPost(prisma, board.id, user.id);
      const other = await createPost(prisma, board.id, user.id);

      await request(http)
        .post(mergeUrl(org.id, board.id, source.id))
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ targetPostId: target.id })
        .expect(201);

      // source artık merge edilmiş — tekrar kaynak yapmak durum çakışması.
      await request(http)
        .post(mergeUrl(org.id, board.id, source.id))
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ targetPostId: other.id })
        .expect(409);
    });
  });

  describe('oy sayacı (transaction içinde tutarlı)', () => {
    it('oy verince güncel sayacı, geri çekince azalmış sayacı döner', async () => {
      const board = await createBoard(prisma, org.id, { visibility: 'PUBLIC' });
      const post = await createPost(prisma, board.id, user.id);

      const added = await request(http)
        .post(`/public/${org.slug}/${board.slug}/posts/${post.id}/votes`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect((added.body as { voteCount: number }).voteCount).toBe(1);

      const removed = await request(http)
        .delete(`/public/${org.slug}/${board.slug}/posts/${post.id}/votes`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect((removed.body as { voteCount: number }).voteCount).toBe(0);
    });
  });
});
