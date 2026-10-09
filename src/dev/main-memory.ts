import 'reflect-metadata';
import { Logger, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createMemoryDataSource } from '../database/memory-db';
import { FEATURE_MODULES } from '../feature-modules';
import { HealthController } from '../health.controller';
import { createJwtTestFixture } from '../test-utils/jwt-test.helper';
import {
  DEV_CUSTOMER,
  DEV_CUSTOMER_APP_ID,
  DEV_SUPPORT_APP_ID,
  DEV_SUPPORT_DOMAIN_ID,
  STAFF_PERSONAS,
} from './dev-personas';
import { DevModule, DevSession } from './dev.module';
import { seedDevData } from './dev-seed';

/**
 * Local runtime with no Docker and no IAM: in-memory Postgres with every
 * migration, the workshop roster, a scripted morning of jobs, and
 * `/v1/dev/session`. Data resets on restart. The durable workshop is
 * `npm run start:workshop`. Production starts from `main.ts`.
 */
async function bootstrap() {
  const logger = new Logger('DevRuntime');
  const signer = await createJwtTestFixture();
  process.env.LOCAL_JWKS_JSON = signer.jwksJson;
  process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = DEV_CUSTOMER_APP_ID;
  process.env.IAM_SUPPORT_DOMAIN_APPLICATION_ID = DEV_SUPPORT_APP_ID;
  process.env.IAM_SUPPORT_DOMAIN_ID = DEV_SUPPORT_DOMAIN_ID;
  delete process.env.IAM_JWT_ISSUER;
  delete process.env.IAM_JWT_AUDIENCE;

  const { dataSource } = await createMemoryDataSource();

  @Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      TypeOrmModule.forRootAsync({
        useFactory: () => ({ ...dataSource.options }),
        dataSourceFactory: () => Promise.resolve(dataSource),
      }),
      ...FEATURE_MODULES,
      DevModule.register(signer),
    ],
    controllers: [HealthController],
  })
  class DevAppModule {}

  const app = await NestFactory.create(DevAppModule);
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
        .setTitle('Autoflex API (dev runtime)')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    ),
  );

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  const baseUrl = `http://localhost:${port}`;

  const session = async (body: Record<string, string>) => {
    const res = await fetch(`${baseUrl}/v1/dev/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return ((await res.json()) as DevSession).accessToken;
  };
  const summary = await seedDevData(dataSource, baseUrl, {
    customer: await session({ phone: DEV_CUSTOMER.phone }),
    manager: await session({ persona: 'manager' }),
    advisor: await session({ persona: 'advisor' }),
    technician: await session({ persona: 'technician' }),
    technician2: await session({ persona: 'technician2' }),
  });

  logger.log(`API on ${baseUrl} · docs on ${baseUrl}/docs`);
  logger.log(
    `Sign in: POST ${baseUrl}/v1/dev/session with {"phone":"${DEV_CUSTOMER.phone}"} or {"persona":"${STAFF_PERSONAS.map((p) => p.key).join('|')}"}`,
  );
  logger.log(`Seeded jobs: ${JSON.stringify(summary.jobs)}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
