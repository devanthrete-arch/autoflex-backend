import { SetMetadata } from '@nestjs/common';
export const REQUIRE_SUPPORT_KEY = 'requireSupport';
export const RequireSupport = () => SetMetadata(REQUIRE_SUPPORT_KEY, true);
