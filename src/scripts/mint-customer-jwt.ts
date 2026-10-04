import { createJwtTestFixture } from '../test-utils/jwt-test.helper';

async function main() {
  const appId =
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID ?? 'cust-app-123';
  const fixture = await createJwtTestFixture();
  const token = await fixture.signAccessToken({
    sub:
      process.env.SEED_CUSTOMER_IAM_USER_ID ??
      '55555555-5555-4555-8555-555555555555',
    domainId: '66666666-6666-4666-8666-666666666666',
    domainApplicationId: appId,
    mobile: '9876543210',
    roles: ['customer'],
    permissions: [],
  });

  console.log(
    '# Put these in autoflex-backend/.env (LOCAL_JWKS only for offline tests)',
  );
  console.log(`IAM_CUSTOMER_DOMAIN_APPLICATION_ID=${appId}`);
  console.log(`LOCAL_JWKS_JSON=${fixture.jwksJson}`);
  console.log('');
  console.log('# Paste this JWT in customer-web Sign In (dev fallback)');
  console.log(token);
}

void main();
