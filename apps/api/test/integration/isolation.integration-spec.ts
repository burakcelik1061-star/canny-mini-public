import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, resetDatabase } from './integration-app';
import { addMember, createBoard, createOrg, registerUser } from './fixtures';
import type { TestOrg, TestUser } from './fixtures';

// Faz "izolasyon sertleştirme" — OrgMembershipGuard + @OrgRoles'un org-scoped
// controller'lara GERÇEKTEN bağlı olduğunu kanıtlar. Buradaki asıl değer:
// biri `@UseGuards(OrgMembershipGuard)` satırını bir controller'dan silerse,
// bu suite kırmızıya döner. Önceden yalnızca voting + billing için izolasyon
// testi vardı; board/tag/admin-posts uçlarının guard'a bağlı olduğu hiçbir
// yerde doğrulanmıyordu (bkz. güvenlik değerlendirmesi Y2).
describe('Org izolasyonu — guard route’lara bağlı mı (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  let owner: TestUser;
  let ownedOrg: TestOrg;
  let boardId: string;

  // ownedOrg'a hiç üye olmayan, BAŞKA bir org'un kullanıcısı.
  let outsider: TestUser;
  // ownedOrg'un MEMBER'ı (üye ama OWNER/ADMIN değil).
  let member: TestUser;

  beforeAll(async () => {
    ({ app, prisma } = await createIntegrationApp());
    http = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await resetDatabase(prisma);

    owner = await registerUser(app);
    ownedOrg = await createOrg(prisma, { ownerId: owner.id });
    // PRO: bu suite ROL/ÜYELİK sınırını test ediyor, plan-limitini değil.
    // FREE bırakılırsa (limit 1 board) aşağıdaki board oluşturma zaten 1
    // board olan org'da plan-limitine (403) takılır ve rol testini gizlerdi.
    await prisma.organization.update({
      where: { id: ownedOrg.id },
      data: { plan: 'PRO' },
    });
    ({ id: boardId } = await createBoard(prisma, ownedOrg.id));

    outsider = await registerUser(app);
    // outsider kendi org'unun OWNER'ı — "hiçbir yetkim yok" değil, "BAŞKA
    // org'da yetkim var" senaryosu (daha gerçekçi bir saldırgan).
    await createOrg(prisma, { ownerId: outsider.id });

    member = await registerUser(app);
    await addMember(prisma, ownedOrg.id, member.id, 'MEMBER');
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe('OrgMembershipGuard — üye olmayan erişemez', () => {
    it('auth’suz board listesi 401', async () => {
      await request(http)
        .get(`/organizations/${ownedOrg.id}/boards`)
        .expect(401);
    });

    it('başka org’un kullanıcısı board listesini göremez (403)', async () => {
      await request(http)
        .get(`/organizations/${ownedOrg.id}/boards`)
        .set(auth(outsider.accessToken))
        .expect(403);
    });

    it('başka org’un kullanıcısı tag listesini göremez (403)', async () => {
      await request(http)
        .get(`/organizations/${ownedOrg.id}/tags`)
        .set(auth(outsider.accessToken))
        .expect(403);
    });

    it('başka org’un kullanıcısı kanban post listesini göremez (403)', async () => {
      await request(http)
        .get(`/organizations/${ownedOrg.id}/boards/${boardId}/posts`)
        .set(auth(outsider.accessToken))
        .expect(403);
    });

    it('org üyesi board listesini görebilir (200) — guard üyeliği geçiriyor', async () => {
      await request(http)
        .get(`/organizations/${ownedOrg.id}/boards`)
        .set(auth(member.accessToken))
        .expect(200);
    });
  });

  describe('@OrgRoles — MEMBER yönetim uçlarına erişemez', () => {
    it('MEMBER board oluşturamaz (403)', async () => {
      await request(http)
        .post(`/organizations/${ownedOrg.id}/boards`)
        .set(auth(member.accessToken))
        .send({ name: 'Yeni board', visibility: 'PUBLIC' })
        .expect(403);
    });

    it('MEMBER tag oluşturamaz (403)', async () => {
      await request(http)
        .post(`/organizations/${ownedOrg.id}/tags`)
        .set(auth(member.accessToken))
        .send({ name: 'bug' })
        .expect(403);
    });

    it('OWNER board oluşturabilir (201) — rol geçişi doğru', async () => {
      await request(http)
        .post(`/organizations/${ownedOrg.id}/boards`)
        .set(auth(owner.accessToken))
        .send({ name: 'Owner board', visibility: 'PUBLIC' })
        .expect(201);
    });
  });
});
