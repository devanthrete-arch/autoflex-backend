import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { Customer } from '../customers/entities/customer.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { MeService } from '../customers/me.service';
import { AuditLog } from '../events/entities/audit-log.entity';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import {
  canonicalIntakePhone,
  tryCanonicalPhone,
} from '../jobs/intake-identity';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { Vehicle } from '../customers/entities/vehicle.entity';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { ConsentRegistrationDto } from './dto/registration.dto';
import { RegistrationSession } from './entities/registration-session.entity';
import { ReceptionIdentityService } from './reception-identity.service';
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const fail = (code: string, message: string): never => {
  throw new UnprocessableEntityException({ code, message });
};
@Injectable()
export class ReceptionService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly identity: ReceptionIdentityService,
    private readonly me: MeService,
  ) {}
  private challenge(id: string) {
    const key = this.config.get<string>('RECEPTION_CHALLENGE_KEY');
    if (!key || key.length < 32)
      throw new ServiceUnavailableException({
        code: 'RECEPTION_NOT_CONFIGURED',
        message: 'Reception registration is not configured.',
      });
    return createHmac('sha256', key)
      .update(`reception-v1:${id}`)
      .digest('base64url');
  }
  private async staff(m: EntityManager, a: AuthContext, lock = false) {
    if (
      a.actorType !== 'staff' ||
      !a.serviceCenterId ||
      !a.staffProfileId ||
      !a.roles.some((r) => ['admin', 'manager', 'advisor'].includes(r)) ||
      !['jobs:create', 'customers:register'].every((p) =>
        a.permissions.includes(p),
      )
    )
      throw new ForbiddenException();
    const center = await m.getRepository(ServiceCenter).findOne({
      where: { id: a.serviceCenterId, status: ServiceCenterStatus.ACTIVE },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    const staff = await m.getRepository(StaffProfile).findOneBy({
      id: a.staffProfileId,
      serviceCenterId: a.serviceCenterId,
      isActive: true,
      iamUserId: a.userId,
    });
    if (!center || !staff) throw new ForbiddenException();
    return center;
  }
  private async session(
    m: EntityManager,
    id: string,
    centerId?: string,
    lock = false,
  ) {
    const row = await m.getRepository(RegistrationSession).findOne({
      where: { id, ...(centerId ? { serviceCenterId: centerId } : {}) },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!row) throw new NotFoundException('Registration request unavailable');
    return row;
  }
  private version(row: RegistrationSession, meta: CommandMeta) {
    if (row.version !== meta.version)
      throw new ConflictException({
        code: 'REGISTRATION_VERSION_CONFLICT',
        message: 'Registration changed. Refresh before continuing.',
      });
  }
  private live(row: RegistrationSession) {
    if (row.state === 'CANCELLED' || row.expiresAt.getTime() <= Date.now())
      fail(
        'REGISTRATION_EXPIRED',
        'This registration request expired or was cancelled. Ask reception for a new request.',
      );
  }
  private accountPhone(profile: CustomerProfile, phone: string) {
    if (profile.phone && tryCanonicalPhone(profile.phone) !== phone)
      throw new ConflictException({
        code: 'REGISTRATION_ACCOUNT_PHONE_MISMATCH',
        message:
          'This request is for a different phone. Sign in with the matching account or ask reception to correct the request. Registration cannot change your account phone.',
      });
  }
  private proof(row: RegistrationSession, challenge: string) {
    if (
      !/^[\w-]{43}$/.test(challenge) ||
      !timingSafeEqual(
        Buffer.from(digest(challenge), 'hex'),
        Buffer.from(row.challengeHash, 'hex'),
      )
    )
      throw new NotFoundException('Registration request unavailable');
  }
  private async audit(
    m: EntityManager,
    row: RegistrationSession,
    a: AuthContext,
    action: string,
  ) {
    await m.getRepository(AuditLog).save({
      serviceCenterId: row.serviceCenterId,
      entityType: 'RECEPTION_REGISTRATION',
      entityId: row.id,
      action,
      actorStaffProfileId: a.actorType === 'staff' ? a.staffProfileId : null,
      metadata: { actorType: a.actorType },
      before: null,
      after: { state: row.state, version: row.version },
    });
  }
  private async view(
    m: EntityManager,
    row: RegistrationSession,
    includeHandoff = false,
  ) {
    let customer: { id: string; revision: number } | null = null;
    if (row.state === 'COMPLETED' && row.customerId) {
      const c = await m.getRepository(Customer).findOneBy({
        id: row.customerId,
        serviceCenterId: row.serviceCenterId,
        customerProfileId: row.customerProfileId!,
      });
      const p = await m
        .getRepository(CustomerProfile)
        .findOneBy({ id: row.customerProfileId! });
      if (c && p) customer = { id: c.id, revision: c.revision };
    }
    return {
      id: row.id,
      version: row.version,
      state:
        row.state === 'CANCELLED'
          ? 'CANCELLED'
          : row.state !== 'COMPLETED' && row.expiresAt.getTime() <= Date.now()
            ? 'EXPIRED'
            : row.state,
      expiresAt: row.expiresAt,
      identityMode:
        this.config.get('RECEPTION_IDENTITY_ISSUER') ===
          'autoflex-local-reception' && process.env.NODE_ENV !== 'production'
          ? 'LOCAL_TEST'
          : 'EXTERNAL',
      identityReady: this.identity.ready,
      customer,
      ...(includeHandoff &&
      row.state === 'WAITING_CUSTOMER' &&
      row.expiresAt.getTime() > Date.now()
        ? {
            handoffPath: `/reception/${row.id}#challenge=${this.challenge(row.id)}`,
          }
        : {}),
    };
  }
  async start(a: AuthContext, phone: string, meta: CommandMeta) {
    const normalized = canonicalIntakePhone(phone);
    this.challenge('readiness');
    if (!meta.key)
      throw new UnprocessableEntityException('Idempotency-Key required');
    return this.db.transaction(async (m) => {
      const center = await this.staff(m, a, true);
      const ref = await withCommandReceipt(
        m,
        `reception:staff:${a.staffProfileId}`,
        meta,
        async () => {
          const row = m.getRepository(RegistrationSession).create({
            serviceCenterId: center.id,
            staffProfileId: a.staffProfileId!,
            phone: normalized,
            state: 'WAITING_CUSTOMER',
            expiresAt: new Date(Date.now() + 20 * 60_000),
          });
          // ID is allocated before hashing so exact start retries can recover the same handoff.
          row.id = randomUUID();
          row.challengeHash = digest(this.challenge(row.id));
          const saved = await m.getRepository(RegistrationSession).save(row);
          await this.audit(m, saved, a, 'RECEPTION_REGISTRATION_STARTED');
          return { id: saved.id };
        },
      );
      return this.view(m, await this.session(m, ref.id, center.id), true);
    });
  }
  async status(a: AuthContext, id: string) {
    await this.staff(this.db.manager, a);
    return this.view(
      this.db.manager,
      await this.session(this.db.manager, id, a.serviceCenterId!),
      true,
    );
  }
  async customerContext(a: AuthContext, id: string, challenge: string) {
    if (a.actorType !== 'customer') throw new ForbiddenException();
    const row = await this.session(this.db.manager, id);
    this.proof(row, challenge);
    this.live(row);
    if (row.customerProfileId) {
      const p = await this.db
        .getRepository(CustomerProfile)
        .findOneBy({ id: row.customerProfileId, iamUserId: a.userId });
      if (!p) throw new NotFoundException('Registration request unavailable');
    }
    const center = await this.db.getRepository(ServiceCenter).findOneBy({
      id: row.serviceCenterId,
      status: ServiceCenterStatus.ACTIVE,
    });
    if (!center) throw new NotFoundException();
    return {
      id: row.id,
      version: row.version,
      state: row.state,
      centerName: center.displayName ?? center.name,
      phoneHint: `••••••${row.phone.slice(-4)}`,
      expiresAt: row.expiresAt,
      identityMode:
        this.config.get('RECEPTION_IDENTITY_ISSUER') ===
          'autoflex-local-reception' && process.env.NODE_ENV !== 'production'
          ? 'LOCAL_TEST'
          : 'EXTERNAL',
      identityReady: this.identity.ready,
    };
  }
  async verification(a: AuthContext, id: string, challenge: string) {
    if (a.actorType !== 'customer') throw new ForbiddenException();
    const row = await this.session(this.db.manager, id);
    this.proof(row, challenge);
    this.live(row);
    if (row.state !== 'WAITING_CUSTOMER')
      throw new ConflictException(
        'Registration already has a customer decision',
      );
    const profile = await this.db
      .getRepository(CustomerProfile)
      .findOneBy({ iamUserId: a.userId });
    if (profile) this.accountPhone(profile, row.phone);
    return this.identity.acquire(a, id, row.phone);
  }
  async consent(
    a: AuthContext,
    id: string,
    dto: ConsentRegistrationDto,
    meta: CommandMeta,
  ) {
    if (a.actorType !== 'customer') throw new ForbiddenException();
    const row = await this.session(this.db.manager, id);
    this.proof(row, dto.challenge);
    // A stored, exact consent may be recovered after the short-lived proof expires.
    // Verification stays outside database locks; only a new command consumes it.
    let verificationId: string | undefined;
    let verificationError: Error | undefined;
    try {
      verificationId = await this.identity.verify(
        dto.verificationAssertion,
        a,
        id,
        row.phone,
      );
    } catch (error) {
      verificationError =
        error instanceof Error
          ? error
          : new Error('Identity verification failed');
    }
    const profile = await this.me.ensureProfile(a);
    return this.db.transaction(async (m) => {
      const center = await m.getRepository(ServiceCenter).findOne({
        where: {
          id: row.serviceCenterId,
          status: ServiceCenterStatus.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!center) throw new NotFoundException();
      return withCommandReceipt(
        m,
        `reception:customer:${a.userId}`,
        meta,
        async () => {
          const p = await m.getRepository(CustomerProfile).findOne({
            where: { id: profile.id, iamUserId: a.userId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!p) throw new ForbiddenException();
          if (verificationError) throw verificationError;
          const current = await this.session(m, id, center.id, true);
          this.proof(current, dto.challenge);
          this.live(current);
          this.version(current, meta);
          if (current.state !== 'WAITING_CUSTOMER')
            throw new ConflictException(
              'Registration already has a customer decision',
            );
          // Recheck under the profile lock: this handoff is not an account
          // phone-change command, even when a signed assertion is supplied.
          this.accountPhone(p, current.phone);
          if (!dto.name.trim())
            fail('CUSTOMER_NAME_REQUIRED', 'Enter your billing/contact name.');
          current.customerProfileId = p.id;
          current.verificationId = verificationId!;
          current.consentAt = new Date();
          current.consentName = dto.name.trim();
          current.state = 'CONSENTED';
          current.version++;
          await m.getRepository(CustomerProfile).update(p.id, {
            displayName: p.displayName ?? dto.name.trim(),
            ...(!p.phone ? { phone: current.phone } : {}),
          });
          await m.getRepository(RegistrationSession).save(current);
          await this.audit(m, current, a, 'RECEPTION_CUSTOMER_CONSENTED');
          return { id, state: current.state, version: current.version };
        },
        async () => {
          const p = await m.getRepository(CustomerProfile).findOne({
            where: { id: profile.id, iamUserId: a.userId },
            lock: { mode: 'pessimistic_read' },
          });
          const latest = await this.session(m, id, center.id);
          if (!p || latest.customerProfileId !== p.id)
            throw new NotFoundException();
        },
      );
    });
  }
  async finish(a: AuthContext, id: string, meta: CommandMeta, cancel = false) {
    return this.db.transaction(async (m) => {
      const center = await this.staff(m, a, true);
      const ref = await withCommandReceipt(
        m,
        `reception:staff:${a.staffProfileId}`,
        meta,
        async () => {
          // Center serializes consent/finalize/cancel; profile precedes the session lock.
          const current = await this.session(m, id, center.id);
          const p = current.customerProfileId
            ? await m.getRepository(CustomerProfile).findOne({
                where: { id: current.customerProfileId },
                lock: { mode: 'pessimistic_write' },
              })
            : null;
          const row = await this.session(m, id, center.id, true);
          this.version(row, meta);
          if (row.state === 'COMPLETED' || row.state === 'CANCELLED')
            throw new ConflictException('Registration already finished');
          if (cancel) {
            row.state = 'CANCELLED';
            row.version++;
            await m.getRepository(RegistrationSession).save(row);
            await this.audit(m, row, a, 'RECEPTION_REGISTRATION_CANCELLED');
            return { id };
          }
          this.live(row);
          if (row.state !== 'CONSENTED')
            fail(
              'REGISTRATION_CUSTOMER_ACTION_REQUIRED',
              'The customer must verify and consent before account linking.',
            );
          if (!p) throw new ForbiddenException('Customer profile unavailable');
          this.accountPhone(p, row.phone);
          if (!p.phone)
            fail(
              'REGISTRATION_ACCOUNT_PHONE_REQUIRED',
              'The account phone changed after consent. Ask reception for a new verification request.',
            );
          if (
            row.state !== 'CONSENTED' ||
            !p ||
            !row.verificationId ||
            !row.consentAt
          )
            fail(
              'REGISTRATION_CUSTOMER_ACTION_REQUIRED',
              'The customer must verify and consent before account linking.',
            );
          const contacts = await m
            .getRepository(Customer)
            .createQueryBuilder('c')
            .where('c.service_center_id = :center', { center: center.id })
            .andWhere(
              "(c.phone_canonical = :phone OR regexp_replace(c.phone, '[^0-9]', '', 'g') IN (:...digits))",
              {
                phone: row.phone,
                digits: [row.phone.slice(1), row.phone.slice(-10)],
              },
            )
            .setLock('pessimistic_write')
            .getMany();
          const matches = contacts.filter(
            (c) =>
              tryCanonicalPhone(c.phone) === row.phone ||
              c.phoneCanonical === row.phone,
          );
          if (matches.length > 1)
            fail(
              'REGISTRATION_LINK_REVIEW_REQUIRED',
              'Conflicting center records require authorized review.',
            );
          let contact = matches[0];
          if (contact?.customerProfileId && contact.customerProfileId !== p.id)
            fail(
              'REGISTRATION_LINK_REVIEW_REQUIRED',
              'This association needs authorized review. No account was changed.',
            );
          if (contact && !contact.customerProfileId) {
            const [jobs, vehicles] = await Promise.all([
              m.getRepository(ServiceJob).count({
                where: { customerId: contact.id },
                withDeleted: true,
              }),
              m.getRepository(Vehicle).count({
                where: { customerId: contact.id },
                withDeleted: true,
              }),
            ]);
            if (jobs || vehicles)
              fail(
                'REGISTRATION_LEGACY_REVIEW_REQUIRED',
                'Historical customer or vehicle records require review before linking. Their access has not changed.',
              );
          }
          if (!contact)
            contact = m.getRepository(Customer).create({
              serviceCenterId: center.id,
              phone: row.phone,
              phoneCanonical: row.phone,
              name: row.consentName,
              revision: 1,
              customerProfileId: p.id,
              consentRecordedAt: row.consentAt,
            });
          else if (!contact.customerProfileId)
            Object.assign(contact, {
              customerProfileId: p.id,
              name: contact.name ?? row.consentName,
              consentRecordedAt: row.consentAt,
              revision: contact.revision + 1,
            });
          contact = await m.getRepository(Customer).save(contact);
          row.customerId = contact.id;
          row.state = 'COMPLETED';
          row.version++;
          await m.getRepository(RegistrationSession).save(row);
          await this.audit(m, row, a, 'RECEPTION_ACCOUNT_LINKED');
          return { id };
        },
        async () => {
          await this.session(m, id, center.id);
        },
      );
      return this.view(m, await this.session(m, ref.id, center.id));
    });
  }
}
