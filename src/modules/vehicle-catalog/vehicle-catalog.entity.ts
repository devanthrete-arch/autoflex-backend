import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';

@Entity('vehicle_catalog_makes')
export class VehicleCatalogMake {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source_key', type: 'varchar', length: 128 })
  sourceKey: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @OneToMany(() => VehicleCatalogModel, (model) => model.make)
  models: VehicleCatalogModel[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('vehicle_catalog_models')
export class VehicleCatalogModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'make_id', type: 'uuid' })
  makeId: string;

  @ManyToOne(() => VehicleCatalogMake, (make) => make.models, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'make_id' })
  make: VehicleCatalogMake;

  @Column({ name: 'source_key', type: 'varchar', length: 128 })
  sourceKey: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ name: 'body_style', type: 'varchar', length: 32 })
  bodyStyle: string;

  @OneToMany(() => VehicleCatalogGeneration, (generation) => generation.model)
  generations: VehicleCatalogGeneration[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('vehicle_catalog_generations')
export class VehicleCatalogGeneration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'model_id', type: 'uuid' })
  modelId: string;

  @ManyToOne(() => VehicleCatalogModel, (model) => model.generations, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'model_id' })
  model: VehicleCatalogModel;

  @Column({ name: 'source_key', type: 'varchar', length: 160 })
  sourceKey: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 8, default: 'IN' })
  market: string;

  @Column({ name: 'introduced_on', type: 'date', nullable: true })
  introducedOn: string | null;

  @Column({ name: 'discontinued_on', type: 'date', nullable: true })
  discontinuedOn: string | null;

  @OneToMany(() => VehicleCatalogPhase, (phase) => phase.generation)
  phases: VehicleCatalogPhase[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('vehicle_catalog_phases')
export class VehicleCatalogPhase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'generation_id', type: 'uuid' })
  generationId: string;

  @ManyToOne(() => VehicleCatalogGeneration, (generation) => generation.phases, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'generation_id' })
  generation: VehicleCatalogGeneration;

  @Column({ name: 'source_key', type: 'varchar', length: 180 })
  sourceKey: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ name: 'introduced_on', type: 'date', nullable: true })
  introducedOn: string | null;

  @Column({ name: 'discontinued_on', type: 'date', nullable: true })
  discontinuedOn: string | null;

  @OneToMany(
    () => VehicleCatalogConfiguration,
    (configuration) => configuration.phase,
  )
  configurations: VehicleCatalogConfiguration[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('vehicle_catalog_configurations')
export class VehicleCatalogConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'phase_id', type: 'uuid' })
  phaseId: string;

  @ManyToOne(() => VehicleCatalogPhase, (phase) => phase.configurations, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'phase_id' })
  phase: VehicleCatalogPhase;

  @Column({ name: 'source_key', type: 'varchar', length: 180 })
  sourceKey: string;

  @Column({ type: 'varchar', length: 128 })
  variant: string;

  @Column({ type: 'varchar', length: 32 })
  fuel: string;

  @Column({ name: 'gearbox_code', type: 'varchar', length: 16 })
  gearboxCode: string;

  @OneToOne(() => VehicleCatalogPowertrain, (powertrain) => powertrain.configuration)
  powertrain: Relation<VehicleCatalogPowertrain>;

  @OneToMany(() => VehicleCatalogColour, (colour) => colour.configuration)
  colours: VehicleCatalogColour[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('vehicle_catalog_powertrains')
export class VehicleCatalogPowertrain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'configuration_id', type: 'uuid' })
  configurationId: string;

  @OneToOne(() => VehicleCatalogConfiguration, (configuration) => configuration.powertrain, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'configuration_id' })
  configuration: VehicleCatalogConfiguration;

  @Column({ name: 'engine_name', type: 'varchar', length: 128, nullable: true })
  engineName: string | null;

  @Column({ name: 'displacement_cc', type: 'integer', nullable: true })
  displacementCc: number | null;

  @Column({ name: 'power_ps', type: 'integer', nullable: true })
  powerPs: number | null;

  @Column({ name: 'drive_type', type: 'varchar', length: 32, nullable: true })
  driveType: string | null;

  @Column({ name: 'seating_capacity', type: 'integer', nullable: true })
  seatingCapacity: number | null;

  @Column({ name: 'kerb_weight_kg', type: 'integer', nullable: true })
  kerbWeightKg: number | null;

  @Column({ name: 'gross_vehicle_weight_kg', type: 'integer', nullable: true })
  grossVehicleWeightKg: number | null;

  @Column({ name: 'emission_norm', type: 'varchar', length: 32, nullable: true })
  emissionNorm: string | null;

  @Column({ name: 'tyre_size', type: 'varchar', length: 64, nullable: true })
  tyreSize: string | null;

  @Column({ name: 'battery_kwh', type: 'double precision', nullable: true })
  batteryKwh: number | null;

  @Column({ name: 'motor_power_kw', type: 'integer', nullable: true })
  motorPowerKw: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('vehicle_catalog_colours')
export class VehicleCatalogColour {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'configuration_id', type: 'uuid' })
  configurationId: string;

  @ManyToOne(() => VehicleCatalogConfiguration, (configuration) => configuration.colours, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'configuration_id' })
  configuration: VehicleCatalogConfiguration;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'available_from', type: 'date', nullable: true })
  availableFrom: string | null;

  @Column({ name: 'available_to', type: 'date', nullable: true })
  availableTo: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
