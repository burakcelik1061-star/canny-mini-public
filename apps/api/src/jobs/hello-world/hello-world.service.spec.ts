import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { HelloWorldService } from './hello-world.service';

describe('HelloWorldService', () => {
  let service: HelloWorldService;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HelloWorldService,
        { provide: getQueueToken('hello-world'), useValue: queue },
      ],
    }).compile();

    service = moduleRef.get(HelloWorldService);
  });

  it('varsayılan mesajla bir job kuyruğa ekler', async () => {
    queue.add.mockResolvedValue({ id: 'job-1' });

    const result = await service.enqueue();

    expect(queue.add).toHaveBeenCalledWith('hello-world', {
      message: 'hello world',
    });
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('verilen mesajla bir job kuyruğa ekler', async () => {
    queue.add.mockResolvedValue({ id: 'job-2' });

    const result = await service.enqueue('merhaba dünya');

    expect(queue.add).toHaveBeenCalledWith('hello-world', {
      message: 'merhaba dünya',
    });
    expect(result).toEqual({ jobId: 'job-2' });
  });

  it('BullMQ id döndürmezse hata fırlatır (beklenmeyen durum)', async () => {
    queue.add.mockResolvedValue({ id: undefined });

    await expect(service.enqueue()).rejects.toThrow('BullMQ job id döndürmedi');
  });
});
