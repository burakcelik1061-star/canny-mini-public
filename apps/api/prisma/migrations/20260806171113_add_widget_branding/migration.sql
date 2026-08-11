-- AlterTable
-- widgetSecret NOT NULL ama mevcut satırlar (7 org) için bir değer yok —
-- pgcrypto gibi bir eklenti gerektirmeyen dahili md5(random()+timestamp) ile
-- geçici bir DEFAULT'la dolduruluyor, sonra DROP DEFAULT ile kaldırılıyor ki
-- yeni org'lar için secret ZORUNLU olarak uygulama kodunda üretilsin
-- (bkz. OrganizationsService.createOrganization — crypto.randomBytes(32)).
ALTER TABLE "organizations" ADD COLUMN     "widgetColor" TEXT NOT NULL DEFAULT '#171717',
ADD COLUMN     "widgetLogoUrl" TEXT,
ADD COLUMN     "widgetSecret" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);

ALTER TABLE "organizations" ALTER COLUMN "widgetSecret" DROP DEFAULT;
