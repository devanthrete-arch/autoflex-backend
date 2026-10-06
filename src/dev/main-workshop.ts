import 'reflect-metadata';
import { Logger, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { FEATURE_MODULES } from '../feature-modules';
import { HealthController } from '../health.controller';
import {
  DEV_CUSTOMER_APP_ID,
  STAFF_PERSONAS,
  WORKSHOP_CUSTOMERS,
} from './dev-personas';
import { DevModule } from './dev.module';
import { loadWorkshopSigner } from './workshop-signer';
import { assertWorkshopSchema, bootstrapWorkshop } from './workshop-bootstrap';

loadEnv();

/**
 * Durable local workshop: real Postgres, the same `/v1/dev/session` stand-in
 * as the memory runtime, and an idempotent roster. Bookings survive restart.
 * Production starts from `main.ts`, which never loads DevModule.
 */
async function bootstrap() {
  const logger = new Logger('Workshop');
  const signer = await loadWorkshopSigner();
  process.env.LOCAL_JWKS_JSON = signer.jwksJson;
  process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = DEV_CUSTOMER_APP_ID;
  process.env.IAM_JWT_ISSUER = '';
  process.env.IAM_JWT_AUDIENCE = '';

  @Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRootAsync({
        useFactory: () => ({
          type: 'postgres' as const,
          host: process.env.DATABASE_HOST ?? 'localhost',
          port: Number(process.env.DATABASE_PORT ?? 5432),
          username: process.env.DATABASE_USER ?? 'autoflex',
          password: process.env.DATABASE_PASSWORD ?? 'autoflex',
          database: process.env.DATABASE_NAME ?? 'autoflex',
          autoLoadEntities: true,
          synchronize: false,
          logging: process.env.DATABASE_LOGGING === 'true',
        }),
      }),
      ...FEATURE_MODULES,
      DevModule.register(signer),
    ],
    controllers: [HealthController],
  })
  class WorkshopAppModule {}

  const app = await NestFactory.create(WorkshopAppModule);
  app.enableCors({ origin: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Autoflex API (durable workshop)')
        .setDescription(
          'Local Postgres workshop. Tokens come from POST /v1/dev/session, a stand-in for Frevels IAM.',
        )
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    ),
  );

  const dataSource = app.get(DataSource);
  await assertWorkshopSchema(dataSource);
  const center = await bootstrapWorkshop(dataSource);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  const baseUrl = `http://localhost:${port}`;
  const customers = WORKSHOP_CUSTOMERS.map(
    (customer) => `${customer.name} ${customer.phone}`,
  ).join(', ');
  logger.log(`API on ${baseUrl} · docs on ${baseUrl}/docs`);
  logger.log(`Center: ${center.name} (${center.id})`);
  logger.log(`Customers: ${customers}`);
  logger.log(
    `Staff: POST ${baseUrl}/v1/dev/session {"persona":"${STAFF_PERSONAS.map((p) => p.key).join('|')}"}`,
  );
  logger.log('Bookings and jobs already in Postgres are left as they are.');
}

bootstrap().catch((error) => {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|password authentication|does not exist/i.test(message)) {
    console.error('Start local Postgres with: docker compose up -d');
    console.error('Then apply migrations with: npm run migration:run');
  }
  process.exit(1);
});
