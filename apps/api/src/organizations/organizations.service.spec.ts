import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationsService } from './organizations.service';

const mockOrg = {
  id: 'org-1',
  name: 'Acme Corp',
  slug: 'acme-corp',
  createdAt: new Date(),
};

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: {
    organization: { findUnique: jest.Mock; update: jest.Mock };
    organizationMember: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn(), update: jest.fn() },
      organizationMember: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(OrganizationsService);
  });

  describe('createOrganization', () => {
    it('isim boşsa/çakışmıyorsa doğrudan slugify edilmiş slug ile oluşturur ve oluşturan OWNER olur', async () => {
      prisma.organization.findUnique.mockResolvedValue(null); // slug boşta
      const tx = {
        organization: { create: jest.fn().mockResolvedValue(mockOrg) },
        organizationMember: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof prisma) => unknown) => cb(tx as never),
      );

      const result = await service.createOrganization('user-1', {
        name: 'Acme Corp',
      });

      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { slug: 'acme-corp' },
      });

      expect(tx.organization.create).toHaveBeenCalledWith({
        data: {
          name: 'Acme Corp',
          slug: 'acme-corp',
          // widgetSecret her org için rastgele üretiliyor (bkz.
          // createOrganization yorumu) — burada sadece "bir hex string
          // verildi" doğrulanıyor, aşağıdaki 'widget ayarları' describe
          // bloğu değerin gerçekten kullanılabilir olduğunu test ediyor.
          widgetSecret: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        },
      });

      expect(tx.organizationMember.create).toHaveBeenCalledWith({
        data: { orgId: 'org-1', userId: 'user-1', role: 'OWNER' },
      });
      expect(result).toEqual({ ...mockOrg, role: 'OWNER' });
    });

    it('slug çakışıyorsa -2, -3... ekleyerek benzersizleştirir', async () => {
      prisma.organization.findUnique
        .mockResolvedValueOnce(mockOrg) // 'acme-corp' dolu
        .mockResolvedValueOnce(mockOrg) // 'acme-corp-2' de dolu
        .mockResolvedValueOnce(null); // 'acme-corp-3' boşta

      const tx = {
        organization: {
          create: jest
            .fn()
            .mockResolvedValue({ ...mockOrg, slug: 'acme-corp-3' }),
        },
        organizationMember: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof prisma) => unknown) => cb(tx as never),
      );

      const result = await service.createOrganization('user-1', {
        name: 'Acme Corp',
      });

      expect(tx.organization.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Acme Corp',
          slug: 'acme-corp-3',
        }) as unknown,
      });

      expect(result.slug).toBe('acme-corp-3');
    });

    it('slugify boş sonuç verirse (ör. sadece semboller) "workspace" öneki kullanılır', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      const tx = {
        organization: {
          create: jest
            .fn()
            .mockResolvedValue({ ...mockOrg, slug: 'workspace' }),
        },
        organizationMember: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof prisma) => unknown) => cb(tx as never),
      );

      await service.createOrganization('user-1', { name: '!!!' });

      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { slug: 'workspace' },
      });
    });
  });

  describe('getMyOrganizations', () => {
    it("kullanıcının üye olduğu org'ları rolüyle birlikte döner", async () => {
      prisma.organizationMember.findMany.mockResolvedValue([
        { role: 'OWNER', organization: mockOrg },
        {
          role: 'MEMBER',
          organization: { ...mockOrg, id: 'org-2', slug: 'other-org' },
        },
      ]);

      const result = await service.getMyOrganizations('user-1');

      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { organization: true },
        orderBy: { joinedAt: 'asc' },
      });
      expect(result).toEqual([
        { ...mockOrg, role: 'OWNER' },
        { ...mockOrg, id: 'org-2', slug: 'other-org', role: 'MEMBER' },
      ]);
    });

    it('hiç üyeliği yoksa boş dizi döner', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([]);

      const result = await service.getMyOrganizations('user-1');

      expect(result).toEqual([]);
    });
  });

  // Faz 4.3 — widget tema/kimlik ayarları.
  describe('getPublicBranding', () => {
    it('org bulunursa color/logoUrl döner (secret sızdırmaz)', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        widgetColor: '#ff0000',
        widgetLogoUrl: 'https://example.com/logo.png',
      });

      const result = await service.getPublicBranding('acme-corp');

      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { slug: 'acme-corp' },
        select: { widgetColor: true, widgetLogoUrl: true },
      });
      expect(result).toEqual({
        color: '#ff0000',
        logoUrl: 'https://example.com/logo.png',
      });
    });

    it('org yoksa NotFoundException fırlatır', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.getPublicBranding('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getOrgWidgetSecret', () => {
    it('org bulunursa id + widgetSecret döner', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        widgetSecret: 'the-secret',
      });

      const result = await service.getOrgWidgetSecret('acme-corp');

      expect(result).toEqual({ id: 'org-1', widgetSecret: 'the-secret' });
    });

    it('org yoksa NotFoundException fırlatır', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.getOrgWidgetSecret('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getWidgetSettings', () => {
    it('secret dahil tüm widget ayarlarını döner (sadece OWNER|ADMIN erişebilir — bkz. controller)', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        widgetColor: '#171717',
        widgetLogoUrl: null,
        widgetSecret: 'the-secret',
      });

      const result = await service.getWidgetSettings('org-1');

      expect(result).toEqual({
        color: '#171717',
        logoUrl: null,
        secret: 'the-secret',
      });
    });
  });

  describe('updateWidgetSettings', () => {
    it('sadece verilen alanları günceller', async () => {
      prisma.organization.update.mockResolvedValue({
        widgetColor: '#00ff00',
        widgetLogoUrl: null,
      });

      await service.updateWidgetSettings('org-1', { color: '#00ff00' });

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { widgetColor: '#00ff00' },
        select: { widgetColor: true, widgetLogoUrl: true },
      });
    });

    it('boş logoUrl string\'i null\'a çevirir ("logoyu kaldır")', async () => {
      prisma.organization.update.mockResolvedValue({
        widgetColor: '#171717',
        widgetLogoUrl: null,
      });

      await service.updateWidgetSettings('org-1', { logoUrl: '' });

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { widgetLogoUrl: null },
        select: { widgetColor: true, widgetLogoUrl: true },
      });
    });
  });

  describe('rotateWidgetSecret', () => {
    it("yeni rastgele bir secret üretip DB'ye yazar ve döner", async () => {
      prisma.organization.update.mockResolvedValue({});

      const result = await service.rotateWidgetSecret('org-1');

      expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { widgetSecret: result.secret },
      });
    });

    it('her çağrıda farklı bir secret üretir', async () => {
      prisma.organization.update.mockResolvedValue({});

      const first = await service.rotateWidgetSecret('org-1');
      const second = await service.rotateWidgetSecret('org-1');

      expect(first.secret).not.toBe(second.secret);
    });
  });
});
