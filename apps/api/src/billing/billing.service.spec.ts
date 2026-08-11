import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Plan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { MockStripeClient } from './mock-stripe.client';
import { STRIPE_CLIENT } from './stripe-client.interface';

describe('BillingService', () => {
  let service: BillingService;
  let prisma: {
    organization: { findUnique: jest.Mock; update: jest.Mock };
    invoice: { create: jest.Mock; findMany: jest.Mock };
    processedWebhookEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let stripeClient: {
    createCheckoutSession: jest.Mock;
    createPortalSession: jest.Mock;
    constructEvent: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn(), update: jest.fn() },
      invoice: { create: jest.fn(), findMany: jest.fn() },
      processedWebhookEvent: { create: jest.fn() },
      // $transaction hem array-form hem INTERACTIVE callback-form'u destekliyor:
      // handleWebhookEvent artık interactive form kullanıyor (idempotency için
      // tx içinde processedWebhookEvent.create + org.update + invoice.create).
      // Callback'e tx olarak `prisma` mock'unun kendisini geçiyoruz ki
      // testlerdeki `prisma.organization.update` gibi assertion'lar çağrıları
      // görsün.
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(prisma)
          : Promise.all(arg as unknown[]),
      ),
    };
    stripeClient = {
      createCheckoutSession: jest.fn(),
      createPortalSession: jest.fn(),
      constructEvent: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: STRIPE_CLIENT, useValue: stripeClient },
      ],
    }).compile();

    service = moduleRef.get(BillingService);
  });

  describe('createCheckoutSession', () => {
    it('org bulunamazsa NotFoundException fırlatır', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.createCheckoutSession('org-1', {
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("org bulunursa stripeClient.createCheckoutSession'i orgId + verilen url'lerle çağırır", async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      stripeClient.createCheckoutSession.mockResolvedValue({
        id: 'cs_mock_1',
        url: '/billing/mock-checkout?...',
      });

      const result = await service.createCheckoutSession('org-1', {
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });

      expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith({
        orgId: 'org-1',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });
      expect(result).toEqual({
        id: 'cs_mock_1',
        url: '/billing/mock-checkout?...',
      });
    });
  });

  describe('handleWebhookEvent', () => {
    it("checkout.session.completed geldiğinde org'u PRO'ya geçirir ve stripe id'lerini kaydeder", async () => {
      stripeClient.constructEvent.mockReturnValue({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_mock_1',
            customer: 'cus_mock_1',
            subscription: 'sub_mock_1',
            metadata: { orgId: 'org-1' },
          },
        },
      });

      await service.handleWebhookEvent('{"raw":"body"}', 't=1,v1=abc');

      expect(stripeClient.constructEvent).toHaveBeenCalledWith(
        '{"raw":"body"}',
        't=1,v1=abc',
      );
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: {
          plan: Plan.PRO,
          stripeCustomerId: 'cus_mock_1',
          stripeSubscriptionId: 'sub_mock_1',
        },
      });
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest.fn() mock çağrı argümanları any */
      expect(prisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: 'org-1',
            currency: 'usd',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it("constructEvent hata fırlatırsa (geçersiz imza) org'a hiç dokunmaz", async () => {
      stripeClient.constructEvent.mockImplementation(() => {
        throw new Error('Geçersiz webhook imzası');
      });

      await expect(
        service.handleWebhookEvent('body', 'bad-signature'),
      ).rejects.toThrow('Geçersiz webhook imzası');
      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe('getBillingOverview', () => {
    it('org bulunamazsa NotFoundException fırlatır', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.getBillingOverview('org-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('org bulunursa plan + faturaları (en yeni önce) döner', async () => {
      prisma.organization.findUnique.mockResolvedValue({ plan: 'PRO' });
      prisma.invoice.findMany.mockResolvedValue([{ id: 'inv-1' }]);

      const result = await service.getBillingOverview('org-1');

      expect(prisma.invoice.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({ plan: 'PRO', invoices: [{ id: 'inv-1' }] });
    });
  });

  describe('createPortalSession', () => {
    it('org bulunamazsa NotFoundException fırlatır', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.createPortalSession('org-1', {
          returnUrl: 'http://localhost:3000/billing',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(stripeClient.createPortalSession).not.toHaveBeenCalled();
    });

    it("org bulunursa stripeClient.createPortalSession'i orgId + returnUrl'le çağırır", async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      stripeClient.createPortalSession.mockResolvedValue({
        url: '/billing/mock-portal?...',
      });

      const result = await service.createPortalSession('org-1', {
        returnUrl: 'http://localhost:3000/billing',
      });

      expect(stripeClient.createPortalSession).toHaveBeenCalledWith({
        orgId: 'org-1',
        returnUrl: 'http://localhost:3000/billing',
      });
      expect(result).toEqual({ url: '/billing/mock-portal?...' });
    });
  });

  describe('cancelSubscription', () => {
    it('org bulunamazsa NotFoundException fırlatır', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.cancelSubscription('org-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it("org'u FREE'e döndürür, stripeSubscriptionId'i temizler", async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      prisma.organization.update.mockResolvedValue({
        id: 'org-1',
        plan: 'FREE',
      });

      const result = await service.cancelSubscription('org-1');

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { plan: Plan.FREE, stripeSubscriptionId: null },
      });
      expect(result).toEqual({ id: 'org-1', plan: 'FREE' });
    });
  });

  describe('getMockClient', () => {
    it('STRIPE_CLIENT gerçekten bir MockStripeClient ise onu döner', async () => {
      const mockClient = new MockStripeClient('secret');
      const moduleRef = await Test.createTestingModule({
        providers: [
          BillingService,
          { provide: PrismaService, useValue: prisma },
          { provide: STRIPE_CLIENT, useValue: mockClient },
        ],
      }).compile();
      const realService = moduleRef.get(BillingService);

      expect(realService.getMockClient()).toBe(mockClient);
    });

    it('STRIPE_CLIENT bir MockStripeClient değilse hata fırlatır', () => {
      expect(() => service.getMockClient()).toThrow(
        'Mock checkout uçları sadece MockStripeClient ile çalışır',
      );
    });
  });
});
