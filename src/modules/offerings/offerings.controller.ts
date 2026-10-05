import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  CreateOfferingDto,
  ListOfferingsQueryDto,
  UpdateOfferingDto,
} from './dto/offering.dto';
import { OfferingsService, type OfferingView } from './offerings.service';

@ApiTags('marketplace')
@Public()
@Controller('v1/marketplace/centers/:centerId/offerings')
export class PublicOfferingsController {
  constructor(private readonly offeringsService: OfferingsService) {}

  @Get()
  @ApiOperation({ summary: "A center's active service menu" })
  list(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Query() query: ListOfferingsQueryDto,
  ): Promise<OfferingView[]> {
    return this.offeringsService.listPublic(centerId, query);
  }
}

@ApiTags('center')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/center/offerings')
export class CenterOfferingsController {
  constructor(private readonly offeringsService: OfferingsService) {}

  @Get()
  @ApiOperation({ summary: 'The full service menu, inactive items included' })
  list(@CurrentAuth() auth: AuthContext): Promise<OfferingView[]> {
    return this.offeringsService.listForCenter(auth);
  }

  @Post()
  @Roles('admin', 'manager')
  @Permissions('center:manage')
  @ApiOperation({ summary: 'Add a service to the menu' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateOfferingDto,
  ): Promise<OfferingView> {
    return this.offeringsService.create(auth, dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @Permissions('center:manage')
  @ApiOperation({ summary: 'Edit, reprice, or pause a service' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferingDto,
  ): Promise<OfferingView> {
    return this.offeringsService.update(auth, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin', 'manager')
  @Permissions('center:manage')
  @ApiOperation({ summary: 'Remove a service; past bookings keep their copy' })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.offeringsService.remove(auth, id);
  }
}
