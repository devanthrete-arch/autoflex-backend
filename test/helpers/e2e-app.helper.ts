import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IMemoryDb } from 'pg-mem';
import { HealthController } from '../../src/health.controller';
import { createMemoryDataSource } from '../../src/database/memory-db';
import { FEATURE_MODULES } from '../../src/feature-modules';

export interface E2eContext {
  app: INestApplication;
  dataSource: DataSource;
  memoryDb: IMemoryDb;
}

export async function createE2eApp(): Promise<E2eContext> {
  const { dataSource, memoryDb } = await createMemoryDataSource();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot(dataSource.options),
      ...FEATURE_MODULES,
    ],
    controllers: [HealthController],
  })
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  return { app, dataSource, memoryDb };
}
