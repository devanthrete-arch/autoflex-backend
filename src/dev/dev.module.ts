import {
  BadRequestException,
  Body,
  Controller,
  DynamicModule,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { Public } from '../modules/auth/decorators/public.decorator';
import type { JwtTestFixture } from '../test-utils/jwt-test.helper';
import {
  customerIdForPhone,
  DEV_CENTER_DOMAINS,
  DEV_CUSTOMER,
  DEV_CUSTOMER_APP_ID,
  DEV_CUSTOMER_DOMAIN_ID,
  DEV_STAFF_APP_ID,
  STAFF_PERSONAS,
  WORKSHOP_CENTER,
  WORKSHOP_CUSTOMERS,
  staffByPhone,
  workshopCustomerByPhone,
} from './dev-personas';

export const DEV_SIGNER = Symbol('DEV_SIGNER');

export type DevSigner = Pick<JwtTestFixture, 'signAccessToken'>;

const SESSION_TTL = '12h';

class DevSessionDto {
  /** A staff persona key; leave out to sign in as a customer. */
  @IsOptional()
  @IsIn(STAFF_PERSONAS.map((p) => p.key))
  persona?: string;

  /** Customer phone, 10 digits or +91…; defaults to the seeded customer. */
  @IsOptional()
  @Matches(/^(?:\+91)?[6-9]\d{9}$/)
  phone?: string;

  /** `staff` looks the phone up on the workshop roster. Default is a customer. */
  @IsOptional()
  @IsIn(['customer', 'staff'])
  actor?: 'customer' | 'staff';
}

export interface DevSession {
  accessToken: string;
  expiresIn: string;
  actor: 'customer' | 'staff';
  userId: string;
  displayName: string | null;
  role: string;
  phone: string;
}

/**
 * Stands in for Frevels IAM login during local development: hands out
 * signed tokens for seeded staff and any customer phone.
 */
@ApiTags('dev')
@Public()
@Controller('v1/dev')
export class DevController {
  constructor(@Inject(DEV_SIGNER) private readonly signer: DevSigner) {}

  @Get('personas')
  @ApiOperation({ summary: 'Seeded people you can sign in as' })
  personas() {
    return {
      center: {
        name: WORKSHOP_CENTER.name,
        slug: WORKSHOP_CENTER.slug,
      },
      customer: DEV_CUSTOMER,
      customers: WORKSHOP_CUSTOMERS.map((customer) => ({
        name: customer.name,
        phone: customer.phone,
      })),
      staff: STAFF_PERSONAS.map((p) => ({
        key: p.key,
        displayName: p.displayName,
        role: p.role,
        designation: p.designation,
        phone: p.mobile,
      })),
    };
  }

  @Post('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mint a local access token' })
  async session(@Body() dto: DevSessionDto): Promise<DevSession> {
    if (dto.persona && dto.phone) {
      throw new BadRequestException('Send persona or phone, not both');
    }
    if (dto.actor === 'staff') {
      if (!dto.phone) {
        throw new BadRequestException('A mobile number is required');
      }
      const persona = staffByPhone(dto.phone);
      if (!persona) {
        throw new UnauthorizedException(
          'No staff account uses this mobile number',
        );
      }
      return this.staffSession(persona);
    }
    if (dto.persona) {
      const persona = STAFF_PERSONAS.find((p) => p.key === dto.persona)!;
      return this.staffSession(persona);
    }
    const phone = (dto.phone ?? DEV_CUSTOMER.phone).slice(-10);
    const known = workshopCustomerByPhone(phone);
    const userId = customerIdForPhone(phone);
    const accessToken = await this.signer.signAccessToken(
      {
        sub: userId,
        domainId: DEV_CUSTOMER_DOMAIN_ID,
        domainApplicationId: DEV_CUSTOMER_APP_ID,
        roles: ['customer'],
        permissions: [],
        mobile: phone,
      },
      { expiresIn: SESSION_TTL },
    );
    return {
      accessToken,
      expiresIn: SESSION_TTL,
      actor: 'customer',
      userId,
      displayName: known?.name ?? null,
      role: 'customer',
      phone: `+91${phone}`,
    };
  }

  private async staffSession(
    persona: (typeof STAFF_PERSONAS)[number],
  ): Promise<DevSession> {
    const accessToken = await this.signer.signAccessToken(
      {
        sub: persona.iamUserId,
        domainId: DEV_CENTER_DOMAINS.apex,
        domainApplicationId: DEV_STAFF_APP_ID,
        roles: [persona.role],
        permissions: persona.permissions,
        mobile: persona.mobile,
      },
      { expiresIn: SESSION_TTL },
    );
    return {
      accessToken,
      expiresIn: SESSION_TTL,
      actor: 'staff',
      userId: persona.iamUserId,
      displayName: persona.displayName,
      role: persona.role,
      phone: `+91${persona.mobile}`,
    };
  }
}

@Module({})
export class DevModule {
  static register(signer: DevSigner): DynamicModule {
    return {
      module: DevModule,
      controllers: [DevController],
      providers: [{ provide: DEV_SIGNER, useValue: signer }],
    };
  }
}
