import { INestApplication } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';

// Test verisi üretimi. İki farklı yol bilinçli olarak karışık kullanılıyor:
//
//   - Kullanıcılar GERÇEK `POST /auth/register` ucundan oluşturuluyor —
//     testin ihtiyacı olan accessToken/refresh cookie'si ancak gerçek akıştan
//     çıkabilir, ayrıca şifre hash'leme de böylece her testte tekrar
//     kanıtlanmış oluyor.
//   - Org/board/post gibi kurulum verileri doğrudan Prisma ile yazılıyor:
//     bunlar testin KONUSU değil (auth/voting/billing webhook), HTTP
//     üzerinden kurmak testleri gereksiz yere org yönetimi uçlarına
//     bağımlı kılardı.

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
  accessToken: string;
  refreshCookie: string;
}

let userCounter = 0;

export async function registerUser(
  app: INestApplication,
  overrides: { email?: string; password?: string; name?: string } = {},
): Promise<TestUser> {
  userCounter += 1;
  const email =
    overrides.email ?? `user${userCounter}-${Date.now()}@example.com`;
  const password = overrides.password ?? 'correct-horse-battery';
  const name = overrides.name ?? `Test User ${userCounter}`;

  const response = await request(app.getHttpServer() as App)
    .post('/auth/register')
    .send({ email, password, name })
    .expect(201);

  const body = response.body as { user: { id: string }; accessToken: string };

  return {
    id: body.user.id,
    email,
    password,
    name,
    accessToken: body.accessToken,
    refreshCookie: extractRefreshCookie(response),
  };
}

// supertest'in `set('Cookie', ...)` beklediği "refreshToken=<değer>" biçimi.
export function extractRefreshCookie(response: request.Response): string {
  const raw = response.headers['set-cookie'] as unknown as
    string[] | string | undefined;
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const refresh = cookies.find((cookie) => cookie.startsWith('refreshToken='));
  if (!refresh) {
    throw new Error('Yanıtta refreshToken cookie’si yok');
  }
  return refresh.split(';')[0];
}

export interface TestOrg {
  id: string;
  slug: string;
  widgetSecret: string;
}

export async function createOrg(
  prisma: PrismaService,
  options: { ownerId?: string; slug?: string; widgetSecret?: string } = {},
): Promise<TestOrg> {
  const slug = options.slug ?? `org-${randomBytes(6).toString('hex')}`;
  const widgetSecret = options.widgetSecret ?? randomBytes(16).toString('hex');

  const org = await prisma.organization.create({
    data: { name: slug, slug, widgetSecret },
    select: { id: true, slug: true },
  });

  if (options.ownerId) {
    await addMember(prisma, org.id, options.ownerId, OrgRole.OWNER);
  }

  return { ...org, widgetSecret };
}

export async function addMember(
  prisma: PrismaService,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<void> {
  await prisma.organizationMember.create({ data: { orgId, userId, role } });
}

export async function createBoard(
  prisma: PrismaService,
  orgId: string,
  options: { slug?: string; visibility?: 'PUBLIC' | 'PRIVATE' } = {},
): Promise<{ id: string; slug: string }> {
  const slug = options.slug ?? `board-${randomBytes(4).toString('hex')}`;
  return prisma.board.create({
    data: {
      orgId,
      name: slug,
      slug,
      visibility: options.visibility ?? 'PUBLIC',
    },
    select: { id: true, slug: true },
  });
}

export async function createPost(
  prisma: PrismaService,
  boardId: string,
  authorId: string,
  options: { title?: string } = {},
): Promise<{ id: string; title: string }> {
  return prisma.post.create({
    data: {
      boardId,
      authorId,
      title: options.title ?? `Post ${randomBytes(4).toString('hex')}`,
      description: 'Integration test post',
    },
    select: { id: true, title: true },
  });
}
