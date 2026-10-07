import { MigrationInterface } from 'typeorm';
import { InitialSchema1730000000000 } from './migrations/1730000000000-InitialSchema';
import { KitVerticalSlice1730000000001 } from './migrations/1730000000001-KitVerticalSlice';
import { PeoplePlacesCenters1730000000002 } from './migrations/1730000000002-PeoplePlacesCenters';
import { DiscoveryReservation1730000000003 } from './migrations/1730000000003-DiscoveryReservation';
import { InCenterService1730000000004 } from './migrations/1730000000004-InCenterService';
import { OwnershipAfterService1730000000005 } from './migrations/1730000000005-OwnershipAfterService';
import { CustomerDateOfBirth1730000000006 } from './migrations/1730000000006-CustomerDateOfBirth';

/** Every migration in apply order. In-memory databases run these by hand. */
export const MIGRATIONS: (new () => MigrationInterface)[] = [
  InitialSchema1730000000000,
  KitVerticalSlice1730000000001,
  PeoplePlacesCenters1730000000002,
  DiscoveryReservation1730000000003,
  InCenterService1730000000004,
  OwnershipAfterService1730000000005,
  CustomerDateOfBirth1730000000006,
];
