import { Req } from '@nestjs/common';
import type { Request } from 'express';
import { menuCommand } from './menu-command';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
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
@Roles('admin', 'manager')
@Permissions('center:manage')
@Controller('v1/center/offerings')
export class CenterOfferingsController {
  constructor(private readonly offeringsService: OfferingsService) {}

  @Get()
  @ApiOperation({ summary: 'The full service menu, inactive items included' })
  list(@CurrentAuth() auth: AuthContext): Promise<OfferingView[]> {
    return this.offeringsService.listForCenter(auth);
  }

  @Post()
  @TransactionalCommand()
  @Roles('admin', 'manager')
  @Permissions('center:manage')
  @ApiOperation({ summary: 'Add a service to the menu' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateOfferingDto,
    @Req() req: Request,
  ): Promise<OfferingView> {
    return this.offeringsService.create(auth, dto, menuCommand(req, dto, true));
  }

  @Patch(':id')
  @TransactionalCommand()
  @Roles('admin', 'manager')
  @Permissions('center:manage')
  @ApiOperation({ summary: 'Edit, reprice, or pause a service' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferingDto,
    @Req() req: Request,
  ): Promise<OfferingView> {
    return this.offeringsService.update(auth, id, dto, menuCommand(req, dto));
  }

  @Delete(':id')
  @TransactionalCommand()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin', 'manager')
  @Permissions('center:manage')
  @ApiOperation({ summary: 'Remove a service; past bookings keep their copy' })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.offeringsService.remove(auth, id, menuCommand(req, {}));
  }
}
