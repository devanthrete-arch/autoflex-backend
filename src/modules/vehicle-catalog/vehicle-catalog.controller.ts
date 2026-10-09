import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { CatalogTree, VehicleCatalogQuery } from './vehicle-catalog.query';

@ApiTags('vehicle-catalog')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/vehicle-catalog')
export class VehicleCatalogController {
  constructor(private readonly catalog: VehicleCatalogQuery) {}

  @Get()
  @ApiOperation({ summary: 'Cars on sale in India, for vehicle onboarding' })
  tree(): Promise<CatalogTree> {
    return this.catalog.tree();
  }
}
