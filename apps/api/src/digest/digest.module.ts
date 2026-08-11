import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { WeeklyDigestController } from './weekly-digest.controller';
import { WeeklyDigestProcessor } from './weekly-digest.processor';
import { WeeklyDigestService } from './weekly-digest.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'weekly-digest' }), EmailModule],
  controllers: [WeeklyDigestController],
  providers: [WeeklyDigestService, WeeklyDigestProcessor],
})
export class DigestModule {}
