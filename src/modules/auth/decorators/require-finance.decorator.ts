import { SetMetadata } from '@nestjs/common';

export const REQUIRE_FINANCE_KEY = 'requireFinance';
export const RequireFinance = () => SetMetadata(REQUIRE_FINANCE_KEY, true);
