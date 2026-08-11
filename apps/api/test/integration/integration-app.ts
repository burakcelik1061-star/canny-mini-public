import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app-setup';
import { WeeklyDigestProcessor } from '../../src/digest/weekly-digest.processor';
import { HelloWorldProcessor } from '../../src/jobs/hello-world/hello-world.processor';
import { StatusChangeNotificationProcessor } from '../../src/notifications/status-change-notification.processor';
import { PrismaService } from '../../src/prisma/prisma.service';

// Faz 7.1 — integration testlerinin ortak kurulumu.
//
// GERÇEK olan: Postgres (test/integration/global-setup.ts'in migrate ettiği
// ayrı bir test veritabanı), Prisma, tüm modül/DI grafiği, guard'lar,
// ValidationPipe, rawBody, HTTP katmanı. Yani unit testlerin (Prisma
// mock'lu *.spec.ts) yapısal olarak kanıtlayamadığı her şey: DB kısıtları
// (@@unique, cascade), guard'ların route'lara gerçekten bağlı olması, DTO
// doğrulaması ve webhook imzasının ham byte'lar üzerinden çalışması.
//
// SAHTE olan: sadece Redis/BullMQ. Job'ların gerçekten işlendiği Faz 5'te
// gerçek Redis'e karşı uçtan uca doğrulandı; 7.1'in
// konusu olan üç alan (auth, voting, billing webhook) hiçbir worker'a
// bağımlı değil, bu yüzden CI'a ikinci bir servis eklemek yerine kuyruklar
// ve processor'lar DI seviyesinde değiştiriliyor.
export interface IntegrationContext {
  app: INestApplication;
  prisma: PrismaService;
  /** Kuyruğa job eklendiğini doğrulamak isteyen testler için. */
  queues: Record<QueueName, MockQueue>;
}

type QueueName =
  'hello-world' | 'status-change-notifications' | 'weekly-digest';

const QUEUE_NAMES: QueueName[] = [
  'hello-world',
  'status-change-notifications',
  'weekly-digest',
];

export interface MockQueue {
  add: jest.Mock;
  upsertJobScheduler: jest.Mock;
}

function createMockQueue(): MockQueue {
  return {
    // BullMQ'nun gerçek dönüşüyle aynı şekil: servisler `job.id`'yi okuyor.
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
  };
}

export async function createIntegrationApp(): Promise<IntegrationContext> {
  const queues = Object.fromEntries(
    QUEUE_NAMES.map((name) => [name, createMockQueue()]),
  ) as Record<QueueName, MockQueue>;

  const builder = Test.createTestingModule({ imports: [AppModule] });

  for (const name of QUEUE_NAMES) {
    builder.overrideProvider(getQueueToken(name)).useValue(queues[name]);
  }

  // Processor'lar (@Processor ile işaretli WorkerHost alt sınıfları)
  // @nestjs/bullmq tarafından taranıp GERÇEK birer BullMQ Worker'ına
  // bağlanıyor — bu, Redis'e canlı bir bağlantı açardı. Düz bir obje ile
  // değiştirilince sınıf üzerindeki @Processor metadata'sı da devre dışı
  // kalıyor, worker hiç kurulmuyor.
  builder.overrideProvider(HelloWorldProcessor).useValue({});
  builder.overrideProvider(StatusChangeNotificationProcessor).useValue({});
  builder.overrideProvider(WeeklyDigestProcessor).useValue({});

  const moduleRef = await builder.compile();

  // rawBody: true — main.ts ile AYNI seçenek. Billing webhook imzası ham
  // gövde byte'ları üzerinden doğrulandığı için bu olmadan webhook
  // testlerinin hiçbiri gerçek yolu test etmiş olmazdı.
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();

  return { app, prisma: app.get(PrismaService), queues };
}

// Her test dosyası arasında temiz bir DB. Tablo listesi elle yazılmıyor —
// pg_tables'tan okunuyor ki yeni bir Prisma modeli eklendiğinde burayı
// güncellemeyi unutmak sessiz bir test kirlenmesine yol açmasın.
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) {
    return;
  }
  const quoted = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  );
}
