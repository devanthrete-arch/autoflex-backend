import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CustomersModule } from './modules/customers/customers.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: Number(config.get<string>('DATABASE_PORT', '5432')),
        username: config.get<string>('DATABASE_USER', 'autoflex'),
        password: config.get<string>('DATABASE_PASSWORD', 'autoflex'),
        database: config.get<string>('DATABASE_NAME', 'autoflex'),
        autoLoadEntities: true,
        synchronize: false,
        logging: config.get<string>('DATABASE_LOGGING') === 'true',
      }),
    }),
    AuthModule,
    TenancyModule,
    CustomersModule,
    JobsModule,
    MarketplaceModule,
    BookingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
