import { Job } from 'bullmq';
import { HelloWorldProcessor } from './hello-world.processor';

describe('HelloWorldProcessor', () => {
  it('job içeriğini işler ve echoedAt döner', async () => {
    const processor = new HelloWorldProcessor();
    const job = {
      id: 'job-1',
      attemptsMade: 0,
      data: { message: 'test mesajı' },
    } as unknown as Job<{ message: string }>;

    const result = await processor.process(job);

    expect(result.echoedAt).toBeDefined();
    expect(new Date(result.echoedAt).toString()).not.toBe('Invalid Date');
  });
});
