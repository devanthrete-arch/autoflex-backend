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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { AddressesService } from './addresses.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/customer-me.dto';
import { CustomerAddress } from './entities/customer-address.entity';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'List saved addresses, default first' })
  list(@CurrentAuth() auth: AuthContext): Promise<CustomerAddress[]> {
    return this.addressesService.list(auth);
  }

  @Post()
  @ApiOperation({ summary: 'Save an address; the first one becomes default' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateAddressDto,
  ): Promise<CustomerAddress> {
    return this.addressesService.create(auth, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an address or make it the default' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<CustomerAddress> {
    return this.addressesService.update(auth, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an address; the newest remaining becomes default',
  })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.addressesService.remove(auth, id);
  }
}
