import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequireCustomer } from '../auth/decorators/require-customer.decorator';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CreateBookingDto, ListSlotsQueryDto } from './dto/create-booking.dto';
import { BookingsService } from './bookings.service';

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
  @Get('centers/:id/slots')
  @ApiOperation({ summary: 'Available SELF_CHECKIN slots' })
  listSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListSlotsQueryDto,
  ) {
    return this.bookingsService.listSlots(id, query);
  }

  @ApiBearerAuth()
  @RequireCustomer()
  @Post('bookings')
  @ApiOperation({ summary: 'Create SELF_CHECKIN booking' })
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
}
