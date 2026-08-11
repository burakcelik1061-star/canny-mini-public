import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { WeeklyDigestService } from './weekly-digest.service';

describe('WeeklyDigestService', () => {
  let service: WeeklyDigestService;
  let queue: { add: jest.Mock; upsertJobScheduler: jest.Mock };

  beforeEach(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WeeklyDigestService,
        { provide: getQueueToken('weekly-digest'), useValue: queue },
      ],
    }).compile();

    service = moduleRef.get(WeeklyDigestService);
  });

  it("onModuleInit her Pazartesi 09:00 cron'uyla tekrarlanan bir job scheduler kurar (upsert, idempotent)", async () => {
    await service.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'weekly-digest-scheduler',
      { pattern: '0 9 * * 1' },
    );
  });

  it('triggerNow tek seferlik bir job ekler ve jobId döner', async () => {
    const result = await service.triggerNow();

    expect(queue.add).toHaveBeenCalledWith('weekly-digest', {});
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('BullMQ id döndürmezse triggerNow hata fırlatır', async () => {
    queue.add.mockResolvedValue({ id: undefined });

    await expect(service.triggerNow()).rejects.toThrow(
      'BullMQ job id döndürmedi',
    );
  });
});
