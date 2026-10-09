import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportAgentProfile } from './support-agent-profile.entity';

/** Small profile lookup module; it has no dependency on the workflow or auth. */
@Module({
  imports: [TypeOrmModule.forFeature([SupportAgentProfile])],
  exports: [TypeOrmModule],
})
export class SupportIdentityModule {}
