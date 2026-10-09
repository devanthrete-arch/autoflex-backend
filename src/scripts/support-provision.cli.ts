import 'reflect-metadata';
import dataSource from '../database/data-source';
import { SupportAgentProfile } from '../modules/support-identity/support-agent-profile.entity';
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--user' || args[2] !== '--name')
    throw new Error(
      'Usage: npm run support:provision -- --user <IAM user id> --name "Display name"',
    );
  const user = args[1].trim(),
    name = args[3].trim();
  const domain = process.env.IAM_SUPPORT_DOMAIN_ID?.trim(),
    application = process.env.IAM_SUPPORT_DOMAIN_APPLICATION_ID?.trim();
  if (
    !domain ||
    !application ||
    application === process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID
  )
    throw new Error(
      'Configure a distinct IAM_SUPPORT_DOMAIN_APPLICATION_ID and IAM_SUPPORT_DOMAIN_ID first',
    );
  if (!user || user.length > 128 || name.length < 3 || name.length > 255)
    throw new Error('User id must be 1–128 characters; display name 3–255');
  await dataSource.initialize();
  try {
    const repo = dataSource.getRepository(SupportAgentProfile);
    await repo
      .createQueryBuilder()
      .insert()
      .values({
        iamDomainId: domain,
        iamUserId: user,
        displayName: name,
        isActive: true,
      })
      .orIgnore()
      .execute();
    const profile = await repo.findOneByOrFail({
      iamDomainId: domain,
      iamUserId: user,
    });
    console.log(
      JSON.stringify(
        {
          id: profile.id,
          displayName: profile.displayName,
          isActive: profile.isActive,
        },
        null,
        2,
      ),
    );
    console.log(
      'Existing profiles are unchanged, including deactivation. IAM roles and permissions must be provisioned independently.',
    );
  } finally {
    await dataSource.destroy();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Support provisioning failed',
  );
  process.exitCode = 1;
});
