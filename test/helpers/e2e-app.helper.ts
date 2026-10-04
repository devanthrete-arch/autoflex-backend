import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { newDb, IMemoryDb } from 'pg-mem';
import { randomUUID } from 'crypto';
import { HealthController } from '../../src/health.controller';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { Customer } from '../../src/modules/customers/entities/customer.entity';
import { CustomerProfile } from '../../src/modules/customers/entities/customer-profile.entity';
import { GarageVehicle } from '../../src/modules/customers/entities/garage-vehicle.entity';
import { CustomersModule } from '../../src/modules/customers/customers.module';
import { AuditLog } from '../../src/modules/events/entities/audit-log.entity';
import { ServiceJobEvent } from '../../src/modules/events/entities/service-job-event.entity';
import { EventsModule } from '../../src/modules/events/events.module';
import { JobAssignment } from '../../src/modules/jobs/entities/job-assignment.entity';
import { ServiceJob } from '../../src/modules/jobs/entities/service-job.entity';
import { JobsModule } from '../../src/modules/jobs/jobs.module';
import { Booking } from '../../src/modules/bookings/entities/booking.entity';
import { BookingsModule } from '../../src/modules/bookings/bookings.module';
import { Promotion } from '../../src/modules/marketplace/entities/promotion.entity';
import {
  ServiceCategory,
  ServiceCenterCategory,
} from '../../src/modules/marketplace/entities/service-category.entity';
import { MarketplaceModule } from '../../src/modules/marketplace/marketplace.module';
import { ServiceCenter } from '../../src/modules/tenancy/entities/service-center.entity';
import { StaffProfile } from '../../src/modules/tenancy/entities/staff-profile.entity';
import { TenancyModule } from '../../src/modules/tenancy/tenancy.module';
import { Vehicle } from '../../src/modules/customers/entities/vehicle.entity';
import { InitialSchema1730000000000 } from '../../src/database/migrations/1730000000000-InitialSchema';
import { KitVerticalSlice1730000000001 } from '../../src/database/migrations/1730000000001-KitVerticalSlice';

const ENTITIES = [
  ServiceCenter,
  StaffProfile,
  Customer,
  Vehicle,
  CustomerProfile,
  GarageVehicle,
  ServiceJob,
  ServiceJobEvent,
  AuditLog,
  JobAssignment,
  ServiceCategory,
  ServiceCenterCategory,
  Promotion,
  Booking,
];

export interface E2eContext {
  app: INestApplication;
  dataSource: DataSource;
  memoryDb: IMemoryDb;
}

function registerPgMemFunctions(db: IMemoryDb): void {
  db.public.registerFunction({
    name: 'version',
    implementation: () => 'PostgreSQL 16.0',
  });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    implementation: () => randomUUID(),
  });
  db.public.registerFunction({
    name: 'current_database',
    implementation: () => 'autoflex_test',
  });
  db.public.registerFunction({
    name: 'quote_ident',
    implementation: (value: string) => `"${value}"`,
  });
  db.public.registerFunction({
    name: 'obj_description',
    implementation: () => null,
  });
}

export async function createE2eApp(): Promise<E2eContext> {
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
  registerPgMemFunctions(memoryDb);
  memoryDb.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      impure: true,
      implementation: () => randomUUID(),
    });
  });

  const dataSource = await memoryDb.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: ENTITIES,
    synchronize: false,
  });
  await dataSource.initialize();

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await new InitialSchema1730000000000().up(queryRunner);
  await new KitVerticalSlice1730000000001().up(queryRunner);
  await queryRunner.release();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot(dataSource.options),
      AuthModule,
      TenancyModule,
      CustomersModule,
      EventsModule,
      JobsModule,
      MarketplaceModule,
      BookingsModule,
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
