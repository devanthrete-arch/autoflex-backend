import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { IamTokenPayload } from '../interfaces/auth-context.interface';

describe('finance JWT identity boundary', () => {
  const tenancy = { resolveTenantContext: jest.fn() };
  const customers = { findByIamUserId: jest.fn() };
  function guard(settings: Record<string, string>) {
    return new JwtAuthGuard(
      {} as never,
      tenancy as never,
      customers as never,
      new ConfigService(settings),
      new Reflector(),
      {} as never,
    );
  }
  const configured = {
    IAM_FINANCE_DOMAIN_APPLICATION_ID: 'finance-app',
    IAM_FINANCE_DOMAIN_ID: 'finance-domain',
    IAM_CUSTOMER_DOMAIN_APPLICATION_ID: 'customer-app',
    IAM_SUPPORT_DOMAIN_APPLICATION_ID: 'support-app',
    IAM_SUPPORT_DOMAIN_ID: 'support-domain',
  };
  const payload: IamTokenPayload = {
    sub: 'reviewer',
    domainApplicationId: 'finance-app',
    domainId: 'finance-domain',
    type: 'access',
    roles: ['finance_reviewer'],
    permissions: ['billing:approve'],
  };
  beforeEach(() => jest.clearAllMocks());
  it('maps configured finance claims without customer, staff, or support lookup', async () => {
    expect(await guard(configured)['buildAuthContext'](payload)).toMatchObject({
      actorType: 'finance',
      serviceCenterId: null,
      staffProfileId: null,
      customerProfileId: null,
    });
    expect(tenancy.resolveTenantContext).not.toHaveBeenCalled();
    expect(customers.findByIamUserId).not.toHaveBeenCalled();
  });
  it.each([
    [{}, payload],
    [configured, { ...payload, domainId: 'garage-domain' }],
    [configured, { ...payload, domainApplicationId: 'customer-app' }],
    [configured, { ...payload, roles: ['admin'] }],
    [
      { ...configured, IAM_CUSTOMER_DOMAIN_APPLICATION_ID: 'finance-app' },
      payload,
    ],
    [{ ...configured, IAM_SUPPORT_DOMAIN_ID: 'finance-domain' }, payload],
  ])(
    'refuses finance identity when its dedicated boundary is absent or mismatched',
    async (settings, token) => {
      await expect(
        guard(settings as Record<string, string>)['buildAuthContext'](token),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tenancy.resolveTenantContext).not.toHaveBeenCalled();
      expect(customers.findByIamUserId).not.toHaveBeenCalled();
    },
  );
});
