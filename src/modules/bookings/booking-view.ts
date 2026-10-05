import { inr } from '../../common/money';
import { generateReference } from '../../common/reference-number';
import { Booking } from './entities/booking.entity';

export function generateBookingNumber(now = new Date()): string {
  return generateReference('AF', now);
}

export interface BookingItemView {
  id: string;
  serviceOfferingId: string | null;
  name: string;
  priceInr: string;
  priceIsStarting: boolean;
  durationMinutes: number;
  quantity: number;
}

export interface BookingAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface BookingView {
  id: string;
  bookingNumber: string | null;
  status: string;
  mode: string;
  estimateInr: string;
  slotStart: Date;
  slotEnd: Date;
  paymentMode: string;
  issueDescription: string | null;
  vehicleId: string;
  serviceCenterId: string;
  vehicleLabel: string;
  registrationNumber: string;
  centerName: string;
  items: BookingItemView[];
  attachments: BookingAttachmentView[];
  serviceJobId: string | null;
  confirmedAt: Date | null;
  checkedInAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: Date;
}

export interface CenterBookingView extends BookingView {
  customer: {
    profileId: string;
    name: string | null;
    phone: string | null;
  };
  vehicle: {
    make: string;
    model: string;
    variant: string | null;
    year: number | null;
    vehicleType: string;
    currentOdometerKm: number | null;
  } | null;
}

export function toBookingView(booking: Booking): BookingView {
  const vehicle = booking.vehicle;
  const center = booking.serviceCenter;
  return {
    id: booking.id,
    bookingNumber: booking.bookingNumber,
    status: booking.status,
    mode: booking.mode,
    estimateInr: inr(booking.estimateInr),
    slotStart: booking.slotStart,
    slotEnd: booking.slotEnd,
    paymentMode: booking.paymentMode,
    issueDescription: booking.issueDescription,
    vehicleId: booking.vehicleId,
    serviceCenterId: booking.serviceCenterId,
    vehicleLabel: vehicle ? `${vehicle.make} ${vehicle.model}` : '',
    registrationNumber: vehicle?.registrationNumber ?? '',
    centerName: center?.displayName || center?.name || '',
    items: (booking.items ?? []).map((item) => ({
      id: item.id,
      serviceOfferingId: item.serviceOfferingId,
      name: item.name,
      priceInr: inr(item.priceInr),
      priceIsStarting: item.priceIsStarting,
      durationMinutes: item.durationMinutes,
      quantity: item.quantity,
    })),
    attachments: (booking.attachments ?? [])
      .filter((attachment) => !attachment.deletedAt)
      .map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        createdAt: attachment.createdAt,
      })),
    serviceJobId: booking.serviceJobId,
    confirmedAt: booking.confirmedAt,
    checkedInAt: booking.checkedInAt,
    cancelledAt: booking.cancelledAt,
    cancelledBy: booking.cancelledBy,
    cancellationReason: booking.cancellationReason,
    createdAt: booking.createdAt,
  };
}

export function toCenterBookingView(booking: Booking): CenterBookingView {
  const vehicle = booking.vehicle;
  const profile = booking.customerProfile;
  return {
    ...toBookingView(booking),
    customer: {
      profileId: booking.customerProfileId,
      name: profile?.displayName ?? null,
      phone: profile?.phone ?? null,
    },
    vehicle: vehicle
      ? {
          make: vehicle.make,
          model: vehicle.model,
          variant: vehicle.variant,
          year: vehicle.year,
          vehicleType: vehicle.vehicleType,
          currentOdometerKm: vehicle.currentOdometerKm,
        }
      : null,
  };
}
