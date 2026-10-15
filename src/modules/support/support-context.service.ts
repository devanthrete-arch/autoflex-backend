import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { SupportRequest } from './support-request.entity';
import { InvoiceStatus } from '../../common/enums/ownership.enum';
import { JobLineStatus } from '../../common/enums/job-work.enum';
import { visitAccessWhere } from '../jobs/visit-access';

@Injectable()
export class SupportContextService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async ownedLinks(
    profileId: string,
    jobId?: string | null,
    bookingId?: string | null,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const booking = bookingId
      ? await manager.getRepository(Booking).findOne({
          where: { id: bookingId, customerProfileId: profileId },
          relations: { serviceCenter: true, vehicle: true },
        })
      : null;
    const job = jobId
      ? await manager.getRepository(ServiceJob).findOne({
          where: { id: jobId, ...visitAccessWhere(profileId) },
          relations: {
            customer: true,
            serviceCenter: true,
            vehicle: true,
            invoices: true,
            lineItems: true,
          },
        })
      : null;
    if (
      (bookingId && !booking) ||
      (jobId && !job) ||
      (booking && job && booking.serviceJobId !== job.id)
    )
      throw new UnprocessableEntityException({
        code: 'SUPPORT_LINK_INVALID',
        message:
          'Choose a booking and service belonging to the same visit on your account',
      });
    if (job)
      job.invoices = job.invoices.filter(
        (invoice) => invoice.customerProfileId === profileId,
      );
    return { booking, job };
  }
  async summary(row: SupportRequest) {
    try {
      const links = await this.ownedLinks(
        row.customerProfileId,
        row.jobId,
        row.bookingId,
      );
      const { booking } = links;
      let { job } = links;
      if (booking?.serviceJobId && !job)
        job = (
          await this.ownedLinks(
            row.customerProfileId,
            booking.serviceJobId,
            row.bookingId,
          )
        ).job;
      const invoice = job?.invoices.find(
        (item) => item.status !== InvoiceStatus.VOID,
      );
      return {
        state: booking || job ? 'AVAILABLE' : 'NONE',
        booking: booking
          ? {
              reference: booking.bookingNumber,
              status: booking.status,
              centerName: booking.serviceCenter.name,
              vehicleLabel: [booking.vehicle.make, booking.vehicle.model]
                .filter(Boolean)
                .join(' '),
              registration: booking.vehicle.registrationNumber,
              slotStart: booking.slotStart,
              estimateInr: booking.estimateInr,
            }
          : null,
        job: job
          ? {
              reference: job.jobNumber,
              status: job.status,
              centerName: job.serviceCenter.name,
              vehicleLabel: job.intakeSnapshot?.vehicleLabel ?? null,
              registration: job.intakeSnapshot?.vehicleRegistration ?? null,
              currentAmountInr: job.lineItems
                .filter((line) =>
                  [JobLineStatus.INCLUDED, JobLineStatus.APPROVED].includes(
                    line.status,
                  ),
                )
                .reduce((total, line) => total + Number(line.amountInr), 0)
                .toFixed(2),
              finalAmountInr: job.finalAmountInr,
              invoice: invoice
                ? {
                    reference: invoice.invoiceNumber,
                    totalInr: invoice.totalInr,
                    paidInr: invoice.paidInr,
                    status: invoice.status,
                  }
                : null,
            }
          : null,
      };
    } catch (error) {
      if (!(error instanceof UnprocessableEntityException)) throw error;
      return { state: 'NEEDS_REVIEW', booking: null, job: null };
    }
  }
}
