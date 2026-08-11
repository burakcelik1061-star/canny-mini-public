import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { HelloWorldController } from './hello-world.controller';
import { HelloWorldProcessor } from './hello-world.processor';
import { HelloWorldService } from './hello-world.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'hello-world' })],
  controllers: [HelloWorldController],
  providers: [HelloWorldService, HelloWorldProcessor],
})
export class HelloWorldModule {}
