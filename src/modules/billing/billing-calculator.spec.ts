import { UnprocessableEntityException } from '@nestjs/common';
import {
  BillingPolicy,
  Buyer,
  calculateInvoice as calculateWithPlace,
  SupplySelection,
  InvoiceCalculationLineInput,
  validateBuyer,
  validatePolicy,
} from './billing-calculator';

function calculateInvoice(
  policy: BillingPolicy,
  buyer: Buyer,
  lines: InvoiceCalculationLineInput[],
  supply: SupplySelection = {
    context: 'AT_CENTER',
    ruleKey: `${buyer.type.toLowerCase()}-${buyer.stateCode}`,
  },
) {
  return calculateWithPlace(policy, buyer, lines, supply);
}

// Synthetic classifications/rates exercise arithmetic, not tax advice or a
// verified registration. Real seller activation requires finance approval.
function policy(): BillingPolicy {
  return {
    seller: {
      name: 'Synthetic Garage',
      address: 'Test Road, Bengaluru',
      pin: '560001',
      stateCode: '29',
      gstin: '29ABCDE1234F1ZW',
      registrationStatus: 'REGULAR',
      signatory: 'Synthetic Finance Reviewer',
    },
    placeOfSupplyRules: [
      {
        key: 'individual-29',
        buyerType: 'INDIVIDUAL',
        buyerStateCode: '29',
        context: 'AT_CENTER',
        supplyStateCode: '29',
        basisReference: 'SYNTHETIC-ONLY',
      },
      {
        key: 'individual-27',
        buyerType: 'INDIVIDUAL',
        buyerStateCode: '27',
        context: 'AT_CENTER',
        supplyStateCode: '27',
        basisReference: 'SYNTHETIC-ONLY',
      },
      {
        key: 'business-29',
        buyerType: 'BUSINESS',
        buyerStateCode: '29',
        context: 'AT_CENTER',
        supplyStateCode: '29',
        basisReference: 'SYNTHETIC-ONLY',
      },
      {
        key: 'business-27',
        buyerType: 'BUSINESS',
        buyerStateCode: '27',
        context: 'AT_CENTER',
        supplyStateCode: '27',
        basisReference: 'SYNTHETIC-ONLY',
      },
    ],
    buyerModes: ['INDIVIDUAL', 'BUSINESS'],
    irp: {
      businessMode: 'NOT_APPLICABLE',
      basisReference: 'SYNTHETIC-EXAMPLE',
    },
    effectiveFrom: '2026-04-01',
    seriesPrefix: 'TEST',
    initialSequence: 1,
    financialYearStartMonth: 4,
    rules: [
      {
        key: 'labour',
        kind: 'LABOUR',
        classificationCode: '998714',
        treatment: 'TAXABLE',
        rateBps: 1800,
        priceMode: 'EXCLUSIVE',
      },
    ],
  };
}

function buyer(): Buyer {
  return {
    type: 'INDIVIDUAL',
    name: 'Test Customer',
    address: 'Customer Road, Bengaluru',
    pin: '560001',
    stateCode: '29',
  };
}

function line(
  overrides: Partial<InvoiceCalculationLineInput> = {},
): InvoiceCalculationLineInput {
  return {
    id: 'line-1',
    kind: 'LABOUR',
    description: 'Synthetic labour',
    quantity: '1.00',
    unitPriceInr: overrides.amountInr ?? '100.00',
    amountInr: '100.00',
    ruleKey: 'labour',
    ...overrides,
  };
}

function errorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    return (error as UnprocessableEntityException).getResponse()['code'];
  }
  throw new Error('Expected the billing value to be rejected');
}

describe('invoice exact calculation', () => {
  it('requires an explicit approved supply case and does not accept an unrelated context', () => {
    expect(
      errorCode(() => calculateWithPlace(policy(), buyer(), [line()])),
    ).toBe('BILLING_PLACE_OF_SUPPLY_REQUIRED');
    expect(
      errorCode(() =>
        calculateInvoice(policy(), buyer(), [line()], {
          context: 'PICKUP_DROP',
          ruleKey: 'individual-29',
        }),
      ),
    ).toBe('BILLING_PLACE_OF_SUPPLY_REQUIRED');
    expect(
      errorCode(() =>
        calculateInvoice(policy(), buyer(), [line()], {
          context: 'AT_CENTER',
          ruleKey: 'business-27',
        }),
      ),
    ).toBe('BILLING_PLACE_OF_SUPPLY_REQUIRED');
  });

  it('uses the approved supply state rather than blindly comparing the buyer address', () => {
    const configured = policy();
    configured.placeOfSupplyRules.push({
      key: 'synthetic-offsite',
      buyerType: 'BUSINESS',
      buyerStateCode: '27',
      context: 'OFFSITE',
      supplyStateCode: '29',
      basisReference: 'SYNTHETIC-EXPLICIT-CASE',
    });
    const recipient: Buyer = {
      ...buyer(),
      type: 'BUSINESS',
      stateCode: '27',
      gstin: '27ABCDE1234F1Z0',
    };
    const result = calculateInvoice(configured, recipient, [line()], {
      context: 'OFFSITE',
      ruleKey: 'synthetic-offsite',
    });
    expect(result.placeOfSupply).toEqual({
      context: 'OFFSITE',
      ruleKey: 'synthetic-offsite',
      stateCode: '29',
      basisReference: 'SYNTHETIC-EXPLICIT-CASE',
    });
    expect(result.lines[0]).toMatchObject({
      cgstInr: '9.00',
      sgstInr: '9.00',
      igstInr: '0.00',
    });
  });

  it('rejects a saved charge that contradicts its quantity and rate without rewriting it', () => {
    const source = line({
      quantity: '2',
      unitPriceInr: '100.00',
      amountInr: '50.00',
    });
    expect(errorCode(() => calculateInvoice(policy(), buyer(), [source]))).toBe(
      'BILLING_LINE_AMOUNT_MISMATCH',
    );
    expect(source.amountInr).toBe('50.00');
    expect(
      calculateInvoice(policy(), buyer(), [
        line({ quantity: '0.5', unitPriceInr: '0.01', amountInr: '0.01' }),
      ]).lines[0].amountInr,
    ).toBe('0.01');
    expect(
      errorCode(() =>
        calculateInvoice(policy(), buyer(), [
          line({ quantity: '0.5', unitPriceInr: '0.01', amountInr: '0.00' }),
        ]),
      ),
    ).toBe('BILLING_LINE_AMOUNT_MISMATCH');
  });

  it('rejects incomplete, duplicate or unapproved place-of-supply policies', () => {
    for (const mutate of [
      (p: BillingPolicy) => {
        p.placeOfSupplyRules = [];
      },
      (p: BillingPolicy) => {
        p.placeOfSupplyRules.push(p.placeOfSupplyRules[0]);
      },
      (p: BillingPolicy) => {
        p.placeOfSupplyRules[0].basisReference = '';
      },
      (p: BillingPolicy) => {
        p.placeOfSupplyRules[0].supplyStateCode = '00';
      },
    ]) {
      const configured = policy();
      mutate(configured);
      expect(errorCode(() => validatePolicy(configured))).toBe(
        'BILLING_POLICY_INVALID',
      );
    }
  });
  it('calculates exclusive same-state tax and totals from explicit rules', () => {
    expect(calculateInvoice(policy(), buyer(), [line()])).toMatchObject({
      subtotalInr: '100.00',
      taxInr: '18.00',
      totalInr: '118.00',
      lines: [
        {
          classificationCode: '998714',
          netInr: '100.00',
          taxableInr: '100.00',
          cgstInr: '9.00',
          sgstInr: '9.00',
          igstInr: '0.00',
          taxInr: '18.00',
          totalInr: '118.00',
        },
      ],
    });
  });

  it('extracts included tax without increasing the saved gross price', () => {
    const configured = policy();
    configured.rules[0].priceMode = 'INCLUSIVE';
    const result = calculateInvoice(configured, buyer(), [
      line({ amountInr: '118.00' }),
    ]);
    expect(result).toMatchObject({
      subtotalInr: '100.00',
      taxInr: '18.00',
      totalInr: '118.00',
    });
    expect(result.lines[0]).toMatchObject({
      amountInr: '118.00',
      netInr: '100.00',
      cgstInr: '9.00',
      sgstInr: '9.00',
    });
  });

  it('uses only IGST when the explicit buyer state differs from the seller', () => {
    const business: Buyer = {
      ...buyer(),
      type: 'BUSINESS',
      stateCode: '27',
      gstin: '27ABCDE1234F1Z0',
    };
    const result = calculateInvoice(policy(), business, [line()]);
    expect(result.lines[0]).toMatchObject({
      cgstInr: '0.00',
      sgstInr: '0.00',
      igstInr: '18.00',
    });
  });

  it('preserves a fractional quantity and its authoritative approved amount', () => {
    const result = calculateInvoice(policy(), buyer(), [
      line({
        quantity: '0.125',
        unitPriceInr: '9.99',
        amountInr: '1.25',
      }),
    ]);
    expect(result.lines[0]).toMatchObject({
      quantity: '0.125',
      unitPriceInr: '9.99',
      amountInr: '1.25',
      taxInr: '0.23',
      cgstInr: '0.11',
      sgstInr: '0.12',
    });
    expect(result.totalInr).toBe('1.48');
  });

  it('rounds each line half-up and consistently assigns odd tax paise to SGST', () => {
    const configured = policy();
    configured.rules[0].rateBps = 500;
    const result = calculateInvoice(configured, buyer(), [
      line({ id: 'a', amountInr: '0.10' }),
      line({ id: 'b', amountInr: '0.10' }),
    ]);
    expect(
      result.lines.map((item) => [item.taxInr, item.cgstInr, item.sgstInr]),
    ).toEqual([
      ['0.01', '0.00', '0.01'],
      ['0.01', '0.00', '0.01'],
    ]);
    expect(result).toMatchObject({
      subtotalInr: '0.20',
      taxInr: '0.02',
      totalInr: '0.22',
    });
  });

  it('reconciles inclusive rounding on a one-paisa boundary', () => {
    const configured = policy();
    configured.rules[0].priceMode = 'INCLUSIVE';
    const result = calculateInvoice(configured, buyer(), [
      line({ amountInr: '0.04' }),
    ]);
    expect(result).toMatchObject({
      subtotalInr: '0.03',
      taxInr: '0.01',
      totalInr: '0.04',
    });
    expect(result.lines[0]).toMatchObject({ cgstInr: '0.00', sgstInr: '0.01' });
  });

  it('keeps exempt/non-GST value in the subtotal without calling it taxable', () => {
    const configured = policy();
    configured.rules.push(
      {
        ...configured.rules[0],
        key: 'exempt',
        treatment: 'EXEMPT',
        rateBps: 0,
      },
      {
        ...configured.rules[0],
        key: 'outside',
        treatment: 'NON_GST',
        rateBps: 0,
      },
    );
    const result = calculateInvoice(configured, buyer(), [
      line(),
      line({ id: 'exempt', ruleKey: 'exempt', amountInr: '25.10' }),
      line({ id: 'non-gst', ruleKey: 'outside', amountInr: '15.20' }),
    ]);
    expect(result).toMatchObject({
      subtotalInr: '140.30',
      taxInr: '18.00',
      totalInr: '158.30',
    });
    expect(result.lines.slice(1).map((item) => item.taxableInr)).toEqual([
      '0.00',
      '0.00',
    ]);
  });

  it('charges a package parent once and copies the included explanatory scope', () => {
    const configured = policy();
    configured.rules[0].kind = 'PACKAGE';
    const scope = [
      { name: 'Activity one', quantity: '2' },
      { name: 'Activity two', quantity: '1' },
    ];
    const result = calculateInvoice(configured, buyer(), [
      line({ kind: 'PACKAGE', scope }),
    ]);
    scope[0].name = 'Later menu edit';
    expect(result.lines).toHaveLength(1);
    expect(result.totalInr).toBe('118.00');
    expect(result.lines[0].scope?.[0]).toEqual({
      name: 'Activity one',
      quantity: '2',
    });
  });

  it('rejects package scope that could fail or silently change in JSON persistence', () => {
    const circular: unknown[] = [];
    circular.push(circular);
    for (const scope of [
      [{ value: Infinity }],
      [{ value: undefined }],
      [1n],
      circular,
    ]) {
      expect(
        errorCode(() => calculateInvoice(policy(), buyer(), [line({ scope })])),
      ).toBe('BILLING_LINE_INVALID');
    }
  });

  it('requires an explicit rule key when more than one same-kind rule exists', () => {
    const configured = policy();
    configured.rules.push({
      ...configured.rules[0],
      key: 'alternate',
      rateBps: 500,
    });
    expect(
      calculateInvoice(configured, buyer(), [line({ ruleKey: 'alternate' })])
        .taxInr,
    ).toBe('5.00');
    expect(
      errorCode(() =>
        calculateInvoice(configured, buyer(), [line({ ruleKey: '' })]),
      ),
    ).toBe('BILLING_CLASSIFICATION_REQUIRED');
  });

  it('rejects source duplicates, unmatched line kinds and unsupported empty invoices', () => {
    expect(
      errorCode(() => calculateInvoice(policy(), buyer(), [line(), line()])),
    ).toBe('BILLING_LINE_DUPLICATE');
    expect(
      errorCode(() =>
        calculateInvoice(policy(), buyer(), [line({ kind: 'PART' })]),
      ),
    ).toBe('BILLING_CLASSIFICATION_REQUIRED');
    expect(errorCode(() => calculateInvoice(policy(), buyer(), []))).toBe(
      'BILLING_LINES_INVALID',
    );
  });

  it.each([
    '-1.00',
    '1e3',
    'NaN',
    'Infinity',
    '0.001',
    '1.00 ',
    '',
    '10000000000.00',
  ])('rejects an unsupported amount %s', (amount) => {
    expect(
      errorCode(() =>
        calculateInvoice(policy(), buyer(), [line({ amountInr: amount })]),
      ),
    ).toBe('BILLING_AMOUNT_INVALID');
  });

  it.each(['0', '0.000000', '-1', '1e2', '0.0000001', '100000000', 'NaN'])(
    'rejects an unsupported quantity %s',
    (quantity) => {
      expect(
        errorCode(() =>
          calculateInvoice(policy(), buyer(), [line({ quantity })]),
        ),
      ).toBe('BILLING_QUANTITY_INVALID');
    },
  );

  it('detects individual taxed amount and aggregate overflows before database writes', () => {
    expect(
      errorCode(() =>
        calculateInvoice(policy(), buyer(), [
          line({ amountInr: '9999999999.99' }),
        ]),
      ),
    ).toBe('BILLING_AMOUNT_OVERFLOW');
    const configured = policy();
    configured.rules[0].rateBps = 0;
    expect(
      errorCode(() =>
        calculateInvoice(configured, buyer(), [
          line({ id: 'a', amountInr: '9999999999.99' }),
          line({ id: 'b', amountInr: '0.01' }),
        ]),
      ),
    ).toBe('BILLING_AMOUNT_OVERFLOW');
    expect(
      calculateInvoice(configured, buyer(), [
        line({ amountInr: '9999999999.99' }),
      ]).totalInr,
    ).toBe('9999999999.99');
  });
});

describe('billing setup and buyer validation', () => {
  it('accepts the explicitly configured synthetic policy and buyer', () => {
    expect(() => validatePolicy(policy())).not.toThrow();
    expect(() => validateBuyer(buyer(), policy())).not.toThrow();
  });

  it('rejects unknown policy and nested keys instead of silently ignoring tax settings', () => {
    const base = policy();
    const invalid = [
      { ...base, defaultRate: 18 },
      { ...base, seller: { ...base.seller, alternateGstin: 'ignored' } },
      { ...base, irp: { ...base.irp, bypass: true } },
      { ...base, rules: [{ ...base.rules[0], taxInclusive: true }] },
    ];
    for (const value of invalid)
      expect(errorCode(() => validatePolicy(value))).toBe(
        'BILLING_POLICY_INVALID',
      );
    expect(
      errorCode(() => validateBuyer({ ...buyer(), taxExempt: true }, base)),
    ).toBe('BILLING_BUYER_INVALID');
  });

  it('allows a composition or unregistered seller only when no GST can be collected', () => {
    for (const status of ['COMPOSITION', 'UNREGISTERED'] as const) {
      const configured = policy();
      configured.seller.registrationStatus = status;
      if (status === 'UNREGISTERED') {
        delete configured.seller.gstin;
        configured.seller.entityReference = 'SYNTHETIC-ENTITY';
      }
      expect(errorCode(() => validatePolicy(configured))).toBe(
        'BILLING_POLICY_INVALID',
      );
      configured.rules[0].treatment = 'NON_GST';
      configured.rules[0].rateBps = 0;
      expect(calculateInvoice(configured, buyer(), [line()])).toMatchObject({
        subtotalInr: '100.00',
        taxInr: '0.00',
        totalInr: '100.00',
      });
    }
  });

  it.each([
    { gstin: '29ABCDE1234F1Z5' },
    { gstin: '27ABCDE1234F1Z0' },
    { gstin: '29abcde1234f1zw' },
    { gstin: undefined },
    { stateCode: '00' },
    { pin: '012345' },
    { name: '' },
    { signatory: '  ' },
    { registrationStatus: 'PENDING' },
  ])('rejects an incomplete or inconsistent seller %j', (overrides) => {
    const configured = policy();
    Object.assign(configured.seller, overrides);
    expect(errorCode(() => validatePolicy(configured))).toBe(
      'BILLING_POLICY_INVALID',
    );
  });

  it('rejects missing rates, duplicate keys, invalid dates and unavailable rule treatments', () => {
    const cases: Array<(value: BillingPolicy) => void> = [
      (value) => {
        delete (value.rules[0] as Partial<BillingPolicy['rules'][number]>)
          .rateBps;
      },
      (value) => {
        value.rules.push({ ...value.rules[0] });
      },
      (value) => {
        value.rules[0].rateBps = 0.1;
      },
      (value) => {
        value.rules[0].rateBps = -1;
      },
      (value) => {
        value.rules[0].rateBps = 10001;
      },
      (value) => {
        value.rules[0].treatment = 'EXEMPT';
      },
      (value) => {
        value.rules[0].classificationCode = '';
      },
      (value) => {
        value.effectiveFrom = '2026-02-30';
      },
      (value) => {
        value.effectiveTo = '2026-03-31';
      },
      (value) => {
        value.seriesPrefix = 'TOOLONG';
      },
      (value) => {
        value.irp.basisReference = '';
      },
      (value) => {
        value.buyerModes = [];
      },
    ];
    for (const mutate of cases) {
      const configured = policy();
      mutate(configured);
      expect(errorCode(() => validatePolicy(configured))).toBe(
        'BILLING_POLICY_INVALID',
      );
    }
  });

  it.each([
    { name: '' },
    { address: '' },
    { pin: '56000' },
    { stateCode: 'Karnataka' },
    { gstin: '29ABCDE1234F1ZW' },
    { type: 'BUSINESS' },
    { type: 'BUSINESS', gstin: '27ABCDE1234F1Z0' },
    { type: 'BUSINESS', gstin: '29ABCDE1234F1Z5' },
  ])('rejects an incomplete or conflicting buyer %j', (overrides) => {
    expect(
      errorCode(() => validateBuyer({ ...buyer(), ...overrides }, policy())),
    ).toBe('BILLING_BUYER_INVALID');
  });

  it('keeps business GSTIN off an individual-only center lane', () => {
    const configured = policy();
    configured.buyerModes = ['INDIVIDUAL'];
    expect(
      errorCode(() =>
        validateBuyer(
          { ...buyer(), type: 'BUSINESS', gstin: '29ABCDE1234F1ZW' },
          configured,
        ),
      ),
    ).toBe('BILLING_BUYER_MODE_UNAVAILABLE');
  });
});
