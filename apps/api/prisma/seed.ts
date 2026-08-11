import { Plan, PostStatus, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

// Faz 7.4 — local demo verisi. `pnpm --filter api seed`
//
// Amaç: repoyu klonlayan birinin (ya da CV'yi inceleyen birinin, ekran
// paylaşımında) boş bir uygulama yerine gerçekten dolu bir board görmesi —
// apps/web'in ana sayfası (`/`) doğrudan buraya link veriyor.
//
// IDEMPOTENT: tekrar tekrar çalıştırılabilir. Her şey sabit slug/email
// üzerinden `upsert` ediliyor, hiçbir şey silinmiyor — script yıkıcı
// DEĞİL, yanlışlıkla dolu bir veritabanında çalıştırılırsa mevcut veriye
// dokunmuyor (sadece kendi demo kayıtlarını günceller).

const prisma = new PrismaClient();

const DEMO_ORG_SLUG = 'demo';
const DEMO_BOARD_SLUG = 'feedback';
const DEMO_PASSWORD = 'demo1234';

// Demo hesapları: biri org sahibi (admin panelini görebilir), ikisi
// "end-user" (org üyeliği yok — bkz. Mimari Kararlar: post açmak üyelik
// gerektirmez). Şifre bilinçli olarak basit ve README'de yazılabilir:
// bunlar sadece local demo hesapları.
const USERS = [
  { email: 'owner@demo.local', name: 'Demo Owner' },
  { email: 'ayse@demo.local', name: 'Ayşe Yılmaz' },
  { email: 'mehmet@demo.local', name: 'Mehmet Demir' },
];

const TAGS = [
  { name: 'bug', color: '#dc2626' },
  { name: 'ux', color: '#7c3aed' },
  { name: 'performans', color: '#0891b2' },
];

// Status dağılımı kanban'ın (3.2) dolu görünmesi için bilinçli olarak
// dört kolona yayıldı.
const POSTS = [
  {
    title: 'Karanlık tema desteği',
    description: 'Gece çalışanlar için koyu bir tema olsun.',
    status: PostStatus.PLANNED,
    tags: ['ux'],
    voters: ['ayse@demo.local', 'mehmet@demo.local'],
    author: 'ayse@demo.local',
  },
  {
    title: 'Board sayfası mobilde yavaş açılıyor',
    description:
      '200+ öneri olan bir board mobil bağlantıda gözle görülür şekilde geç yükleniyor.',
    status: PostStatus.IN_PROGRESS,
    tags: ['bug', 'performans'],
    voters: ['mehmet@demo.local'],
    author: 'mehmet@demo.local',
  },
  {
    title: 'Önerilere dosya eklenebilsin',
    description: 'Ekran görüntüsü olmadan hataları anlatmak zor.',
    status: PostStatus.UNDER_REVIEW,
    tags: [],
    voters: ['ayse@demo.local'],
    author: 'ayse@demo.local',
  },
  {
    title: 'E-posta bildirimleri',
    description: 'Oy verdiğim bir öneri ilerlediğinde haberim olsun.',
    status: PostStatus.COMPLETE,
    tags: [],
    voters: ['ayse@demo.local', 'mehmet@demo.local'],
    author: 'mehmet@demo.local',
  },
];

async function main(): Promise<void> {
  console.log('Seed başlıyor…');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const users = new Map<string, string>(); // email -> id
  for (const user of USERS) {
    const created = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name },
      create: { email: user.email, name: user.name, password: passwordHash },
      select: { id: true },
    });
    users.set(user.email, created.id);
  }

  const org = await prisma.organization.upsert({
    where: { slug: DEMO_ORG_SLUG },
    update: { name: 'Demo Workspace', plan: Plan.FREE },
    create: {
      slug: DEMO_ORG_SLUG,
      name: 'Demo Workspace',
      plan: Plan.FREE,
      // widgetSecret NOT NULL (4.3) — uygulama kodu üretmek zorunda.
      widgetSecret: randomBytes(16).toString('hex'),
    },
    select: { id: true },
  });

  const ownerId = users.get('owner@demo.local')!;
  await prisma.organizationMember.upsert({
    where: { orgId_userId: { orgId: org.id, userId: ownerId } },
    update: { role: 'OWNER' },
    create: { orgId: org.id, userId: ownerId, role: 'OWNER' },
  });

  const board = await prisma.board.upsert({
    where: { orgId_slug: { orgId: org.id, slug: DEMO_BOARD_SLUG } },
    update: { name: 'Feedback' },
    create: {
      orgId: org.id,
      slug: DEMO_BOARD_SLUG,
      name: 'Feedback',
      visibility: 'PUBLIC',
    },
    select: { id: true },
  });

  const tags = new Map<string, string>(); // name -> id
  for (const tag of TAGS) {
    const created = await prisma.tag.upsert({
      where: { orgId_name: { orgId: org.id, name: tag.name } },
      update: { color: tag.color },
      create: { orgId: org.id, name: tag.name, color: tag.color },
      select: { id: true },
    });
    tags.set(tag.name, created.id);
  }

  for (const post of POSTS) {
    // Post'un doğal bir unique anahtarı yok (başlık unique değil) — bu
    // yüzden upsert yerine "başlık+board ile ara, yoksa oluştur".
    const existing = await prisma.post.findFirst({
      where: { boardId: board.id, title: post.title },
      select: { id: true },
    });

    const postId =
      existing?.id ??
      (
        await prisma.post.create({
          data: {
            boardId: board.id,
            authorId: users.get(post.author)!,
            title: post.title,
            description: post.description,
            status: post.status,
          },
          select: { id: true },
        })
      ).id;

    await prisma.post.update({
      where: { id: postId },
      data: {
        status: post.status,
        tags: { set: post.tags.map((name) => ({ id: tags.get(name)! })) },
      },
    });

    for (const voterEmail of post.voters) {
      const userId = users.get(voterEmail)!;
      await prisma.vote.upsert({
        where: { postId_userId: { postId, userId } },
        update: {},
        create: { postId, userId },
      });
    }
  }

  // Tek bir yorum: post detay sayfasının (2.4) da boş görünmemesi için.
  const commentedPost = await prisma.post.findFirst({
    where: { boardId: board.id, title: POSTS[0].title },
    select: { id: true },
  });
  if (commentedPost) {
    const existingComment = await prisma.comment.findFirst({
      where: { postId: commentedPost.id },
      select: { id: true },
    });
    if (!existingComment) {
      await prisma.comment.create({
        data: {
          postId: commentedPost.id,
          authorId: users.get('mehmet@demo.local')!,
          body: 'Buna ihtiyacım var, özellikle gece vardiyasında.',
        },
      });
    }
  }

  console.log(`Seed tamam:
  Demo board : /${DEMO_ORG_SLUG}/${DEMO_BOARD_SLUG}
  Admin      : /admin/${DEMO_ORG_SLUG}
  Giriş      : owner@demo.local / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('Seed başarısız:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
