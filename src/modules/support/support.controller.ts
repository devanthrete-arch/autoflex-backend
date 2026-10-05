import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CreateSupportRequestDto } from './dto/support.dto';
import { SupportService, type SupportRequestView } from './support.service';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/support-requests')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<SupportRequestView[]> {
    return this.support.list(auth);
  }

  @Post()
  @ApiOperation({ summary: 'Ask for help; returns an SR reference' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateSupportRequestDto,
  ): Promise<SupportRequestView> {
    return this.support.create(auth, dto);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupportRequestView> {
    return this.support.get(auth, id);
  }
}
