import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Faz 4.3 — organization.widgetSecret'ı GENEL bir varsayılan olarak
    // gizler: createOrganization/getMyOrganizations gibi `select` YAZMADAN
    // ham Organization döndüren metodlar bu sayede secret'ı yanlışlıkla
    // sızdırmaz (bir önceki halde tam olarak bu olmuştu — `GET
    // /organizations` widgetSecret'ı her org üyesine döndürüyordu). Bu
    // client-level `omit`, per-query `select` tarafından override edilir —
    // OrganizationsService.getOrgWidgetSecret/getWidgetSettings kendi
    // `select: { widgetSecret: true }` ile bilinçli olarak isteyip alıyor.
    super({ omit: { organization: { widgetSecret: true } } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
