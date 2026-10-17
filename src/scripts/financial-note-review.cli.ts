import 'reflect-metadata';
/** Internal finance client; authentication, review and receipts stay on the API. */
async function main() {
  const [operation, id, version, key, evidenceReference] =
    process.argv.slice(2);
  const token = process.env.AUTOFLEX_FINANCE_TOKEN;
  const base = new URL(process.env.AUTOFLEX_API_URL ?? 'http://127.0.0.1:3001');
  if (
    base.protocol !== 'https:' &&
    !(
      process.env.NODE_ENV !== 'production' &&
      base.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    )
  )
    throw new Error('Use HTTPS for the finance API');
  if (
    !token ||
    !id ||
    !/^[a-f0-9-]{36}$/i.test(id) ||
    !['review', 'issue'].includes(operation)
  )
    throw new Error(
      'Provide AUTOFLEX_FINANCE_TOKEN and: billing:note review <invoice-id>, or billing:note issue <note-id> <version> <same-retry-key> <private-evidence-reference>',
    );
  if (
    operation === 'issue' &&
    (!/^[1-9]\d*$/.test(version ?? '') ||
      !Number.isSafeInteger(Number(version)) ||
      !/^[A-Za-z0-9_.:-]{8,128}$/.test(key ?? '') ||
      !evidenceReference?.trim())
  )
    throw new Error(
      'Issue requires the reviewed note version, a persistent command key and evidence reference',
    );
  const path =
    operation === 'review'
      ? `/v1/internal/invoices/${id}/notes`
      : `/v1/internal/financial-notes/${id}/issue`;
  const result = await fetch(new URL(path, base), {
    method: operation === 'review' ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(operation === 'issue'
        ? {
            'Content-Type': 'application/json',
            'If-Match': version,
            'Idempotency-Key': key,
          }
        : {}),
    },
    ...(operation === 'issue'
      ? { body: JSON.stringify({ evidenceReference }) }
      : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const body = (await result.json()) as unknown;
  if (!result.ok)
    throw new Error(
      `Finance request returned ${result.status}: ${JSON.stringify(body)}`,
    );
  console.log(JSON.stringify(body, null, 2));
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Finance request failed.',
  );
  process.exitCode = 1;
});
