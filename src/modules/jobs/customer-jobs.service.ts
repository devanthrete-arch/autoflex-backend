import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobApprovalStatus } from '../../common/enums/job-work.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { MeService } from '../customers/me.service';
import { DecideApprovalDto } from './dto/job-work.dto';
import { ServiceJob } from './entities/service-job.entity';
import { JobEstimateService } from './job-estimate.service';
import {
  computeTotals,
  CustomerJobView,
  PublicTrackingView,
  toCustomerJobView,
  toPublicTrackingView,
} from './job-view';

export interface CustomerJobSummary {
  id: string;
  jobNumber: string | null;
  status: string;
  serviceType: string;
  centerName: string | null;
  vehicleRegistration: string | null;
  garageVehicleId: string | null;
  estimatedReadyAt: Date | null;
  awaitingDecision: boolean;
  currentInr: string;
  bookingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CUSTOMER_RELATIONS = {
  serviceCenter: true,
  vehicle: true,
  customer: true,
  events: true,
  lineItems: true,
  approvals: true,
  media: true,
  invoices: true,
} as const;

/** Jobs reach the owner through the center customer linked to their profile. */
@Injectable()
export class CustomerJobsService {
  constructor(
    @InjectRepository(ServiceJob)
    private readonly jobRepository: Repository<ServiceJob>,
    private readonly meService: MeService,
    private readonly estimateService: JobEstimateService,
  ) {}

  async list(auth: AuthContext): Promise<CustomerJobSummary[]> {
    const profile = await this.meService.ensureProfile(auth);
    const jobs = await this.jobRepository.find({
      where: { customer: { customerProfileId: profile.id } },
      relations: {
        serviceCenter: true,
        vehicle: true,
        customer: true,
        lineItems: true,
        approvals: true,
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return jobs.map((job) => ({
      id: job.id,
      jobNumber: job.jobNumber,
      status: job.status,
      serviceType: job.serviceType,
      centerName: job.serviceCenter
        ? (job.serviceCenter.displayName ?? job.serviceCenter.name)
        : null,
      vehicleRegistration: job.vehicle?.registrationNumber ?? null,
      garageVehicleId: job.vehicle?.garageVehicleId ?? null,
      estimatedReadyAt: job.estimatedReadyAt,
      awaitingDecision: (job.approvals ?? []).some(
        (approval) => approval.status === JobApprovalStatus.PENDING,
      ),
      currentInr: computeTotals(
        (job.lineItems ?? []).filter((line) => !line.deletedAt),
      ).currentInr,
      bookingId: job.sourceBookingId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }));
  }

  async get(auth: AuthContext, jobId: string): Promise<CustomerJobView> {
    return toCustomerJobView(await this.getOwned(auth, jobId));
  }

  async decide(
    auth: AuthContext,
    jobId: string,
    approvalId: string,
    dto: DecideApprovalDto,
  ): Promise<CustomerJobView> {
    const job = await this.getOwned(auth, jobId);
    await this.estimateService.decideAsCustomer(
      job,
      approvalId,
      job.customer.customerProfileId!,
      dto,
    );
    return this.get(auth, jobId);
  }

  async track(publicToken: string): Promise<PublicTrackingView> {
    const job = await this.jobRepository.findOne({
      where: { publicToken },
      relations: { serviceCenter: true, vehicle: true, events: true },
    });
    if (!job) {
      throw new NotFoundException();
    }
    return toPublicTrackingView(job);
  }

  private async getOwned(
    auth: AuthContext,
    jobId: string,
  ): Promise<ServiceJob> {
    const profile = await this.meService.ensureProfile(auth);
    const job = await this.jobRepository.findOne({
      where: { id: jobId, customer: { customerProfileId: profile.id } },
      relations: CUSTOMER_RELATIONS,
    });
    if (!job) {
      throw new NotFoundException();
    }
    return job;
  }
}
