import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { HelloWorldJobData } from './hello-world.processor';

@Injectable()
export class HelloWorldService {
  constructor(
    @InjectQueue('hello-world')
    private readonly queue: Queue<HelloWorldJobData>,
  ) {}

  async enqueue(message = 'hello world'): Promise<{ jobId: string }> {
    const job = await this.queue.add('hello-world', { message });
    // job.id BullMQ tarafından garanti string (auto-increment id verilmediği
    // sürece), ama tip tanımında `string | undefined` — burada assert
    // etmiyoruz, boş string'e düşürmek yerine hatayı gerçekten görmek daha
    // faydalı (asla olmaması gereken bir durum).
    if (!job.id) {
      throw new Error('BullMQ job id döndürmedi (beklenmeyen durum)');
    }
    return { jobId: job.id };
  }
}
