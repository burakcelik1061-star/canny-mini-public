import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { MockStripeClient } from './mock-stripe.client';
import { STRIPE_CLIENT } from './stripe-client.interface';

// EmailModule (Faz 5.2) ile aynı desen: bugün tek `useClass`/`useFactory`
// `MockStripeClient`, ileride gerçek bir `stripe` paketiyle konuşan
// `RealStripeClient` eklenince burada değişecek tek yer bu olacak.
// `useFactory` (düz `useClass` değil) çünkü MockStripeClient'ın
// constructor'ı `webhookSecret`'ı DI ile değil düz bir string parametresiyle
// alıyor (env okuma sorumluluğu modülde, client'ın kendisi ConfigService'e
// bağımlı değil — testte `new MockStripeClient('secret')` yeterli).
@Module({
  imports: [PrismaModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    // OrganizationsModule'daki OrgMembershipGuard kullanımıyla aynı gerekçe:
    // guard @UseGuards(OrgMembershipGuard) ile class referansından
    // kullanılıyor, Nest'in DI ile örnekleyebilmesi için bu modülün de
    // provider listesinde olması gerekiyor.
    OrgMembershipGuard,
    {
      provide: STRIPE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const webhookSecret = configService.get<string>(
          'STRIPE_WEBHOOK_SECRET',
        );
        if (!webhookSecret) {
          throw new Error(
            'STRIPE_WEBHOOK_SECRET tanımlı değil (.env → bkz. .env.example)',
          );
        }
        return new MockStripeClient(webhookSecret);
      },
    },
  ],
})
export class BillingModule {}
