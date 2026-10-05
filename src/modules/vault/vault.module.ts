import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { VaultController } from './vault.controller';
import { VaultDocument } from './vault-document.entity';
import { VaultService } from './vault.service';

@Module({
  imports: [TypeOrmModule.forFeature([VaultDocument]), CustomersModule],
  controllers: [VaultController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
