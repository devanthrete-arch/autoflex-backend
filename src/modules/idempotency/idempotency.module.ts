import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommandIdempotency } from './command-idempotency.entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([CommandIdempotency])],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class IdempotencyModule {}
