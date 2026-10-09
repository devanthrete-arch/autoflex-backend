import { SetMetadata } from '@nestjs/common';
export const TRANSACTIONAL_COMMAND_KEY = 'transactionalCommand';
/** The service owns the receipt inside its business transaction. */
export const TransactionalCommand = () =>
  SetMetadata(TRANSACTIONAL_COMMAND_KEY, true);
