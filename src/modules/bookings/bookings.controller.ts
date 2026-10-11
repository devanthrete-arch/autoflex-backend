import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import { RequireStaff } from '../auth/decorators/require-staff.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import {
  CancelBookingDto,
  CheckInBookingDto,
  CreateAttachmentDto,
  CreateBookingDto,
  DeclineBookingDto,
  ListCenterBookingsQueryDto,
  ListSlotsQueryDto,
  ValidateBookingSelectionDto,
} from './dto/create-booking.dto';
import { BookingsService } from './bookings.service';
import { CenterBookingsService } from './center-bookings.service';
import { BookingSelectionRateLimitGuard } from './booking-selection-rate-limit.guard';

@ApiTags('bookings')
@Controller('v1')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Public()
  @Get('centers/:id/booking-options')
  @ApiOperation({ summary: 'Booking modes for a center' })
  bookingOptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.bookingOptions(id);
  }

  @Public()
  @Post('centers/:id/booking-selection')
  @UseGuards(BookingSelectionRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Validate current menu selections before choosing a vehicle; does not reserve capacity',
  })
  validateSelection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateBookingSelectionDto,
  ) {
    return this.bookingsService.validateSelection(id, dto);
  }

  @Public()
  @Get('centers/:id/slots')
  @ApiOperation({ summary: 'Slots for one IST date with remaining capacity' })
  listSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListSlotsQueryDto,
  ) {
    return this.bookingsService.listSlots(id, query);
  }

  @ApiBearerAuth()
  @RequireCustomer()
  @Post('bookings')
  @ApiOperation({ summary: 'Reserve a SELF_CHECKIN slot' })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(auth, dto);
  }

  @ApiBearerAuth()
  @RequireCustomer()
  @Get('bookings')
  @ApiOperation({ summary: 'List own bookings, newest first' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.bookingsService.listForCustomer(auth);
  }

  @ApiBearerAuth()
  @RequireCustomer()
  @Get('bookings/:id')
  @ApiOperation({ summary: 'Get own booking' })
  getOne(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookingsService.getOne(auth, id);
  }

  @ApiBearerAuth()
  @RequireCustomer()
  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel own booking before the slot starts' })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookingsService.cancel(auth, id, dto);
  }

  @ApiBearerAuth()
  @RequireCustomer()
  @Post('bookings/:id/attachments')
  @ApiOperation({ summary: 'Register a photo, PDF, or voice note' })
  addAttachment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAttachmentDto,
  ) {
    return this.bookingsService.addAttachment(auth, id, dto);
  }

  @ApiBearerAuth()
  @RequireCustomer()
  @Delete('bookings/:id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an attachment' })
  async removeAttachment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<void> {
    await this.bookingsService.removeAttachment(auth, id, attachmentId);
  }
}

@ApiTags('center')
@ApiBearerAuth()
@RequireStaff()
@Controller('v1/center/bookings')
export class CenterBookingsController {
  constructor(private readonly centerBookingsService: CenterBookingsService) {}

  @Get()
  @Roles('admin', 'manager', 'advisor')
  @Permissions('bookings:read')
  @ApiOperation({
    summary: 'Bookings for one IST date or an inclusive from/to range',
  })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListCenterBookingsQueryDto,
  ) {
    return this.centerBookingsService.list(auth, query);
  }

  @Get('pending')
  @Roles('admin', 'manager', 'advisor')
  @Permissions('bookings:read')
  @ApiOperation({ summary: 'Requests waiting for the center to accept' })
  listPending(@CurrentAuth() auth: AuthContext) {
    return this.centerBookingsService.listPending(auth);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'advisor')
  @Permissions('bookings:read')
  @ApiOperation({ summary: 'One booking with customer and vehicle' })
  getOne(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.centerBookingsService.getOne(auth, id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'manager', 'advisor')
  @Permissions('bookings:manage')
  @ApiOperation({ summary: 'Accept a pending request' })
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.centerBookingsService.confirm(auth, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'manager', 'advisor')
  @Permissions('bookings:manage')
  @ApiOperation({ summary: 'Decline or cancel with a reason for the customer' })
  decline(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineBookingDto,
  ) {
    return this.centerBookingsService.decline(auth, id, dto);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'manager', 'advisor')
  @Permissions('bookings:manage')
  @ApiOperation({ summary: 'Record that the customer did not arrive' })
  noShow(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.centerBookingsService.markNoShow(auth, id);
  }

  @Post(':id/check-in')
  @Roles('admin', 'manager', 'advisor')
  @Permissions('bookings:manage', 'jobs:create')
  @ApiOperation({ summary: 'Vehicle arrived: open the job from this booking' })
  checkIn(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckInBookingDto,
  ) {
    return this.centerBookingsService.checkIn(auth, id, dto);
  }
}
