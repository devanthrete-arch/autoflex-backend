import { SetMetadata } from '@nestjs/common';

export const REQUIRE_CUSTOMER_KEY = 'requireCustomer';
export const RequireCustomer = () => SetMetadata(REQUIRE_CUSTOMER_KEY, true);
