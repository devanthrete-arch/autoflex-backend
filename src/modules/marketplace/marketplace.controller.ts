import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ListCentersQueryDto } from './dto/list-centers-query.dto';
import { AvailableServicesQueryDto } from './dto/discovery-area-query.dto';
import { MarketplaceService } from './marketplace.service';
import { PostalLocationService } from './postal-location.service';

@ApiTags('marketplace')
@Public()
@Controller('v1/marketplace')
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly postalLocations: PostalLocationService,
  ) {}

  @Get('postal-locations/:postalCode')
  @ApiOperation({
    summary: 'Resolve an Indian PIN to postal localities, district and state',
  })
  postalLocation(@Param('postalCode') postalCode: string) {
    return this.postalLocations.lookup(postalCode);
  }

  @Get('discovery-config')
  @ApiOperation({ summary: 'Public customer discovery defaults' })
  getDiscoveryConfig() {
    return this.marketplaceService.discoveryConfig();
  }

  @Get('available-services')
  @ApiOperation({
    summary: 'Shared services offered in the selected discovery area',
  })
  availableServices(@Query() query: AvailableServicesQueryDto) {
    return this.marketplaceService.availableServices(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List service categories' })
  listCategories(@Query('vehicleType') vehicleType?: string) {
    return this.marketplaceService.listCategories(vehicleType);
  }

  @Get('offers')
  @ApiOperation({ summary: 'List platform offers' })
  listOffers() {
    return this.marketplaceService.listOffers();
  }

  @Get('centers')
  @ApiOperation({ summary: 'List nearby centers' })
  listCenters(@Query() query: ListCentersQueryDto) {
    return this.marketplaceService.listCenters(query);
  }

  @Get('centers/:id')
  @ApiOperation({ summary: 'Provider profile' })
  getCenter(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketplaceService.getCenter(id);
  }
}
