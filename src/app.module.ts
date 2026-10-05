import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FEATURE_MODULES } from './feature-modules';
import { HealthController } from './health.controller';

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
    ...FEATURE_MODULES,
  ],
  controllers: [HealthController],
})
export class AppModule {}
