import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { MeService } from '../customers/me.service';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { NotificationsService } from './notifications.service';
import type { NotificationView } from './notifications.service';

@ApiTags('me')
@ApiBearerAuth()
@RequireCustomer()
@Controller('v1/me/notifications')
export class CustomerNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly meService: MeService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Inbox, newest first, with the unread count' })
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query('unreadOnly') unreadOnly?: string,
  ): Promise<{ items: NotificationView[]; unreadCount: number }> {
    const profile = await this.meService.ensureProfile(auth);
    return this.notifications.list(profile.id, unreadOnly === 'true');
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every notification read' })
  async readAll(
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ updated: number }> {
    const profile = await this.meService.ensureProfile(auth);
    return this.notifications.markAllRead(profile.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one notification read' })
  async read(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationView> {
    const profile = await this.meService.ensureProfile(auth);
    return this.notifications.markRead(profile.id, id);
  }
}

@ApiTags('jobs')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/jobs/:id/notifications')
export class JobNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles('admin', 'manager', 'advisor')
  @Permissions('jobs:read')
  @ApiOperation({ summary: 'Messages sent to the customer about this job' })
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationDelivery[]> {
    return this.notifications.listForJob(auth.serviceCenterId!, id);
  }
}
