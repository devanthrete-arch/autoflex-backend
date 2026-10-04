import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PromotionScope } from '../../../common/enums/promotion-scope.enum';

@Entity('promotions')
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: PromotionScope })
  scope: PromotionScope;

  @Column({ type: 'varchar', length: 255, nullable: true })
  kicker: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'percent_off', type: 'integer', nullable: true })
  percentOff: number | null;

  @Column({ name: 'cta_label', type: 'varchar', length: 64, nullable: true })
  ctaLabel: string | null;

  @Column({ name: 'image_url', type: 'varchar', length: 1024, nullable: true })
  imageUrl: string | null;

  @Column({ name: 'service_center_id', type: 'uuid', nullable: true })
  serviceCenterId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
