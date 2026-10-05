import { SetMetadata } from '@nestjs/common';

export const REQUIRE_STAFF_KEY = 'requireStaff';
export const RequireStaff = () => SetMetadata(REQUIRE_STAFF_KEY, true);
