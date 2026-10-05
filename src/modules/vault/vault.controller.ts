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
import { RecordStatus } from '../../common/enums/ownership.enum';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  CreateVaultDocumentDto,
  ListVaultQueryDto,
  UpdateVaultDocumentDto,
} from './dto/vault.dto';
import {
  VaultService,
  type VaultDocumentView,
  type VaultUploadTarget,
} from './vault.service';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/documents')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get()
  @ApiOperation({ summary: 'My documents (active by default)' })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListVaultQueryDto,
  ): Promise<VaultDocumentView[]> {
    return this.vault.list(auth, query);
  }

  @Post()
  @ApiOperation({ summary: 'Add a document; declare a file to upload' })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateVaultDocumentDto,
  ): Promise<VaultUploadTarget> {
    return this.vault.create(auth, dto);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VaultDocumentView> {
    return this.vault.get(auth, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit details or replace the file' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVaultDocumentDto,
  ): Promise<VaultUploadTarget> {
    return this.vault.update(auth, id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the declared file as uploaded' })
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VaultDocumentView> {
    return this.vault.confirm(auth, id);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VaultDocumentView> {
    return this.vault.setStatus(auth, id, RecordStatus.ARCHIVED);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VaultDocumentView> {
    return this.vault.setStatus(auth, id, RecordStatus.ACTIVE);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.vault.remove(auth, id);
  }
}
