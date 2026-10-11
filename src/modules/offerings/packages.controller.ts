import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { TransactionalCommand } from '../idempotency/transactional-command.decorator';
import {
  ListOfferingsQueryDto,
  ListServiceDefinitionsQueryDto,
} from './dto/offering.dto';
import { SavePackageDto } from './dto/package.dto';
import { menuCommand } from './menu-command';
import { OfferingsService } from './offerings.service';

@Public()
@Controller('v1/marketplace/services')
export class CatalogController {
  constructor(private readonly menus: OfferingsService) {}
  @Get() list(@Query() query: ListServiceDefinitionsQueryDto) {
    return this.menus.definitions(query);
  }
}
@Public()
@Controller('v1/marketplace/centers/:centerId/packages')
export class PublicPackagesController {
  constructor(private readonly menus: OfferingsService) {}
  @Get() list(
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Query() query: ListOfferingsQueryDto,
  ) {
    return this.menus.packages(centerId, query.vehicleType);
  }
}
@RequireStaff()
@Roles('admin', 'manager')
@Permissions('center:manage')
@Controller('v1/center/packages')
export class CenterPackagesController {
  constructor(private readonly menus: OfferingsService) {}
  @Get() list(@CurrentAuth() auth: AuthContext) {
    return this.menus.packages(auth.serviceCenterId!, undefined, auth);
  }
  @Post()
  @TransactionalCommand()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SavePackageDto,
    @Req() req: Request,
  ) {
    return this.menus.savePackage(
      auth,
      undefined,
      dto,
      menuCommand(req, dto, true),
    );
  }
  @Put(':id')
  @TransactionalCommand()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SavePackageDto,
    @Req() req: Request,
  ) {
    return this.menus.savePackage(auth, id, dto, menuCommand(req, dto));
  }
}
