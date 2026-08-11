import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global: her modülde ayrı ayrı import etmeye gerek kalmasın diye
// (org/board/post modülleri de Faz 2+'da bunu kullanacak).
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
