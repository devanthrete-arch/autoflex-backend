import { SignJWT } from 'jose';
import { randomUUID } from 'crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { RequireCustomer } from '../modules/auth/decorators/require-customer.decorator';
import { CurrentAuth } from '../modules/auth/decorators/current-auth.decorator';
import type { AuthContext } from '../modules/auth/interfaces/auth-context.interface';
import { canonicalIntakePhone } from '../modules/jobs/intake-identity';
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
  SUPPORT_PERSONAS,
  DEV_SUPPORT_APP_ID,
  DEV_SUPPORT_DOMAIN_ID,
  WORKSHOP_CENTER,
  WORKSHOP_CUSTOMERS,
  staffByPhone,
  workshopCustomerByPhone,
} from './dev-personas';

export const DEV_SIGNER = Symbol('DEV_SIGNER');

export type DevSigner = Pick<JwtTestFixture, 'signAccessToken'> & Partial<Pick<JwtTestFixture, 'privateKey'>>;

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
  @IsIn(['customer', 'staff', 'support'])
  actor?: 'customer' | 'staff' | 'support';
}

export interface DevSession {
  accessToken: string;
  expiresIn: string;
  actor: 'customer' | 'staff' | 'support';
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
      support: SUPPORT_PERSONAS.map((p) => ({
        key: p.key,
        displayName: p.displayName,
        role: p.role,
        phone: p.mobile,
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
    if (dto.actor === 'support') {
      if (!dto.phone || dto.persona)
        throw new BadRequestException('Use a named support mobile number');
      const persona = SUPPORT_PERSONAS.find(
        (p) => p.mobile === dto.phone!.slice(-10),
      );
      if (!persona)
        throw new UnauthorizedException(
          'No support account uses this mobile number',
        );
      const accessToken = await this.signer.signAccessToken(
        {
          sub: persona.iamUserId,
          domainId: DEV_SUPPORT_DOMAIN_ID,
          domainApplicationId: DEV_SUPPORT_APP_ID,
          roles: [persona.role],
          permissions: [...persona.permissions],
          mobile: persona.mobile,
        },
        { expiresIn: SESSION_TTL },
      );
      return {
        accessToken,
        expiresIn: SESSION_TTL,
        actor: 'support',
        userId: persona.iamUserId,
        displayName: persona.displayName,
        role: persona.role,
        phone: `+91${persona.mobile}`,
      };
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

class DevReceptionProofDto { @IsUUID() sessionId: string; }
/** Only registered by local development entry points; never production AppModule. */
@Controller('v1/dev/reception-proof') @RequireCustomer()
export class DevReceptionProofController {
  constructor(@Inject(DEV_SIGNER) private readonly signer:DevSigner) {}
  @Post() @HttpCode(200)
  async proof(@CurrentAuth() auth:AuthContext,@Body() body:DevReceptionProofDto) {
    if(process.env.NODE_ENV==='production'||!this.signer.privateKey||process.env.RECEPTION_IDENTITY_ISSUER!=='autoflex-local-reception') throw new ServiceUnavailableException();
    const assertion=await new SignJWT({purpose:'reception-registration',sessionId:body.sessionId,phone:canonicalIntakePhone(auth.phone??''),domainId:auth.domainId,domainApplicationId:auth.domainApplicationId,verifiedAt:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:'test-primary'}).setIssuer('autoflex-local-reception').setAudience('autoflex-reception').setSubject(auth.userId).setJti(randomUUID()).setIssuedAt().setExpirationTime('5m').sign(this.signer.privateKey);
    return {assertion,mode:'LOCAL_TEST_ONLY'};
  }
}

@Module({})
export class DevModule {
  static register(signer: DevSigner): DynamicModule {
    return {
      module: DevModule,
      controllers: [DevController, DevReceptionProofController],
      providers: [{ provide: DEV_SIGNER, useValue: signer }],
    };
  }
}
