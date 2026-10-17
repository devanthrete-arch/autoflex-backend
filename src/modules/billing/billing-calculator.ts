import { UnprocessableEntityException } from '@nestjs/common';

export type BillingLineKind = 'LABOUR' | 'PART' | 'FEE' | 'PACKAGE';
export type BillingTreatment = 'TAXABLE' | 'EXEMPT' | 'NON_GST';
export type BillingBuyerType = 'INDIVIDUAL' | 'BUSINESS';
export type SupplyContext = 'AT_CENTER' | 'PICKUP_DROP' | 'FLEET' | 'OFFSITE';
export interface PlaceOfSupplyRule {
  key: string;
  buyerType: BillingBuyerType;
  buyerStateCode: string;
  context: SupplyContext;
  supplyStateCode: string;
  basisReference: string;
}
export interface SupplySelection {
  context: SupplyContext;
  ruleKey: string;
}

export interface BillingRule {
  key: string;
  kind: BillingLineKind;
  classificationCode: string;
  treatment: BillingTreatment;
  /** Total GST percentage expressed as basis points: 1800 means 18%. */
  rateBps: number;
  priceMode: 'INCLUSIVE' | 'EXCLUSIVE';
}

export interface BillingPolicy {
  cancellation?: {
    unpaid: 'ALLOW';
    maxAgeDays: number;
    basisReference: string;
  };
  discounts?: {
    mode: 'LINE_BEFORE_TAX';
    maxBps: number;
    basisReference: string;
  };
  corrections?: {
    creditPrefix: string;
    debitPrefix: string;
    initialSequence: number;
    maxAgeDays: number;
    basisReference: string;
    taxMode: 'ORIGINAL_COMPONENT_PROPORTION';
  };
  seller: {
    name: string;
    address: string;
    stateCode: string;
    pin: string;
    gstin?: string;
    entityReference?: string;
    registrationStatus: 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';
    phone?: string;
    signatory: string;
  };
  buyerModes: BillingBuyerType[];
  irp: {
    businessMode: 'NOT_APPLICABLE' | 'REQUIRED';
    basisReference: string;
  };
  effectiveFrom: string;
  effectiveTo?: string;
  seriesPrefix: string;
  initialSequence: number;
  financialYearStartMonth: 4;
  rules: BillingRule[];
  placeOfSupplyRules: PlaceOfSupplyRule[];
}

export interface Buyer {
  type: BillingBuyerType;
  name: string;
  address: string;
  pin: string;
  stateCode: string;
  gstin?: string;
}

export interface InvoiceCalculationLineInput {
  id: string;
  kind: BillingLineKind;
  description: string;
  quantity: string;
  unitPriceInr: string;
  /** Saved amount must match the rounded quantity × unit price before tax. */
  amountInr: string;
  scope?: unknown[];
  ruleKey: string;
  discountInr?: string;
  discountReason?: string;
}

export interface CalculatedInvoiceLine extends InvoiceCalculationLineInput {
  classificationCode: string;
  treatment: BillingTreatment;
  /** Pre-tax amount, including exempt and non-GST supplies. */
  netInr: string;
  /** Taxable value; zero for exempt and non-GST supplies. */
  taxableInr: string;
  cgstInr: string;
  sgstInr: string;
  igstInr: string;
  taxInr: string;
  totalInr: string;
  rateBps: number;
  priceMode: BillingRule['priceMode'];
}

export interface InvoiceCalculation {
  placeOfSupply: {
    context: SupplyContext;
    ruleKey: string;
    stateCode: string;
    basisReference: string;
  };
  lines: CalculatedInvoiceLine[];
  subtotalInr: string;
  taxInr: string;
  totalInr: string;
}

// Existing monetary columns are numeric(12, 2). Bound both each line and sums.
const MAX_PAISE = 999_999_999_999n;
const KINDS: BillingLineKind[] = ['LABOUR', 'PART', 'FEE', 'PACKAGE'];
const TREATMENTS: BillingTreatment[] = ['TAXABLE', 'EXEMPT', 'NON_GST'];
const BUYER_TYPES: BillingBuyerType[] = ['INDIVIDUAL', 'BUSINESS'];
const REGISTRATION_STATUSES = ['REGULAR', 'COMPOSITION', 'UNREGISTERED'];
const PRICE_MODES = ['INCLUSIVE', 'EXCLUSIVE'];
const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function fail(code: string, message: string): never {
  throw new UnprocessableEntityException({ code, message });
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, 'The billing value must be an object');
  }
  return value as Record<string, unknown>;
}

function knownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail(code, 'The billing value contains unsupported fields');
}

function text(
  value: unknown,
  field: string,
  code: string,
  max = 500,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    Array.from(value).some((char) => {
      const point = char.charCodeAt(0);
      return (point < 32 && ![9, 10, 13].includes(point)) || point === 127;
    })
  ) {
    fail(code, `${field} must be nonempty text without surrounding whitespace`);
  }
}

function choice(
  value: unknown,
  allowed: readonly string[],
  field: string,
  code: string,
): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(code, `${field} has an unsupported value`);
  }
}

function state(value: unknown, code: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^(0[1-9]|[12]\d|3[0-8]|97|99)$/.test(value)
  ) {
    fail(code, 'A supported two-digit India state code is required');
  }
}

function pin(value: unknown, code: string): void {
  if (typeof value !== 'string' || !/^[1-9]\d{5}$/.test(value)) {
    fail(code, 'A six-digit India PIN is required');
  }
}

function date(value: unknown, code: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-')
  ) {
    fail(code, 'An actual calendar date in YYYY-MM-DD format is required');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    fail(code, 'An actual calendar date in YYYY-MM-DD format is required');
  }
}

/** Syntax/checksum checks are not a substitute for verifying live registration. */
function gstin(value: unknown, stateCode: string, code: string): void {
  if (
    typeof value !== 'string' ||
    !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value) ||
    value.slice(0, 2) !== stateCode
  ) {
    fail(code, 'GSTIN must have a valid format and match the billing state');
  }
  let factor = 2;
  let sum = 0;
  for (let index = 13; index >= 0; index -= 1) {
    const product = GSTIN_ALPHABET.indexOf(value[index]) * factor;
    sum += Math.floor(product / 36) + (product % 36);
    factor = factor === 2 ? 1 : 2;
  }
  if (GSTIN_ALPHABET[(36 - (sum % 36)) % 36] !== value[14]) {
    fail(code, 'GSTIN checksum is invalid');
  }
}

export function validatePolicy(value: unknown): asserts value is BillingPolicy {
  const code = 'BILLING_POLICY_INVALID';
  const policy = object(value, code);
  knownFields(
    policy,
    [
      'seller',
      'buyerModes',
      'irp',
      'effectiveFrom',
      'effectiveTo',
      'seriesPrefix',
      'initialSequence',
      'financialYearStartMonth',
      'rules',
      'placeOfSupplyRules',
      'discounts',
      'corrections',
      'cancellation',
    ],
    code,
  );
  if (policy.cancellation !== undefined) {
    const c = object(policy.cancellation, code);
    knownFields(c, ['unpaid', 'maxAgeDays', 'basisReference'], code);
    choice(c.unpaid, ['ALLOW'], 'Unpaid cancellation policy', code);
    if (
      !Number.isSafeInteger(c.maxAgeDays) ||
      Number(c.maxAgeDays) < 0 ||
      Number(c.maxAgeDays) > 3660
    )
      fail(code, 'Approve a valid unpaid cancellation period');
    text(c.basisReference, 'Approved unpaid cancellation basis', code, 500);
  }
  if (policy.discounts !== undefined) {
    const d = object(policy.discounts, code);
    knownFields(d, ['mode', 'maxBps', 'basisReference'], code);
    choice(d.mode, ['LINE_BEFORE_TAX'], 'Discount mode', code);
    if (
      !Number.isSafeInteger(d.maxBps) ||
      Number(d.maxBps) < 0 ||
      Number(d.maxBps) > 10000
    )
      fail(
        code,
        'Discount limit must be an integer from zero to 10000 basis points',
      );
    text(d.basisReference, 'Approved discount basis', code, 500);
  }
  if (policy.corrections !== undefined) {
    const c = object(policy.corrections, code);
    knownFields(
      c,
      [
        'creditPrefix',
        'debitPrefix',
        'initialSequence',
        'maxAgeDays',
        'basisReference',
        'taxMode',
      ],
      code,
    );
    for (const key of ['creditPrefix', 'debitPrefix']) {
      if (
        typeof c[key] !== 'string' ||
        !/^[A-Z0-9]{1,4}$/.test(c[key]) ||
        c[key] === policy.seriesPrefix
      )
        fail(code, 'Approve separate credit and debit number prefixes');
    }
    if (c.creditPrefix === c.debitPrefix)
      fail(code, 'Correction series must be distinct');
    if (
      !Number.isSafeInteger(c.initialSequence) ||
      Number(c.initialSequence) < 1 ||
      Number(c.initialSequence) > 999999 ||
      !Number.isSafeInteger(c.maxAgeDays) ||
      Number(c.maxAgeDays) < 0 ||
      Number(c.maxAgeDays) > 3660
    )
      fail(code, 'Approve a valid correction cutover and maximum age in days');
    text(c.basisReference, 'Approved correction basis', code, 500);
    choice(
      c.taxMode,
      ['ORIGINAL_COMPONENT_PROPORTION'],
      'Correction tax allocation',
      code,
    );
  }
  const seller = object(policy.seller, code);
  knownFields(
    seller,
    [
      'name',
      'address',
      'stateCode',
      'pin',
      'gstin',
      'entityReference',
      'registrationStatus',
      'phone',
      'signatory',
    ],
    code,
  );
  text(seller.name, 'Seller legal name', code, 255);
  text(seller.address, 'Seller billing address', code, 2000);
  state(seller.stateCode, code);
  pin(seller.pin, code);
  text(seller.signatory, 'Seller signatory', code, 255);
  choice(
    seller.registrationStatus,
    REGISTRATION_STATUSES,
    'Registration status',
    code,
  );
  if (seller.phone !== undefined) text(seller.phone, 'Seller phone', code, 30);
  if (seller.registrationStatus === 'UNREGISTERED') {
    if (seller.gstin !== undefined)
      fail(code, 'An unregistered seller cannot declare a GSTIN');
    if (
      typeof seller.entityReference !== 'string' ||
      !/^[A-Z0-9_-]{1,80}$/.test(seller.entityReference)
    )
      fail(
        code,
        'An unregistered seller requires an approved stable legal-entity reference',
      );
  } else {
    gstin(seller.gstin, seller.stateCode, code);
  }
  if (
    !Array.isArray(policy.buyerModes) ||
    !policy.buyerModes.length ||
    policy.buyerModes.length > 2 ||
    new Set(policy.buyerModes).size !== policy.buyerModes.length
  ) {
    fail(code, 'Select at least one distinct supported buyer type');
  }
  for (const type of policy.buyerModes)
    choice(type, BUYER_TYPES, 'Buyer type', code);
  const irp = object(policy.irp, code);
  knownFields(irp, ['businessMode', 'basisReference'], code);
  choice(
    irp.businessMode,
    ['NOT_APPLICABLE', 'REQUIRED'],
    'IRP business mode',
    code,
  );
  text(irp.basisReference, 'IRP applicability basis', code, 500);
  if (
    irp.businessMode === 'REQUIRED' &&
    seller.registrationStatus !== 'REGULAR'
  ) {
    fail(code, 'IRP-required invoices need a regular GST seller');
  }
  date(policy.effectiveFrom, code);
  if (policy.effectiveTo !== undefined) {
    date(policy.effectiveTo, code);
    if (policy.effectiveTo < policy.effectiveFrom)
      fail(code, 'The policy end date precedes its start');
  }
  if (policy.financialYearStartMonth !== 4)
    fail(code, 'The fiscal year must start in April');
  if (
    !Number.isSafeInteger(policy.initialSequence) ||
    (policy.initialSequence as number) < 1 ||
    (policy.initialSequence as number) > 999999
  )
    fail(
      code,
      'Approve an initial sequence from 1 to 999999 for the numbering cutover',
    );
  if (
    typeof policy.seriesPrefix !== 'string' ||
    !/^[A-Z0-9]{1,4}$/.test(policy.seriesPrefix)
  ) {
    fail(
      code,
      'The series prefix must contain one to four uppercase letters or digits',
    );
  }
  if (
    !Array.isArray(policy.rules) ||
    !policy.rules.length ||
    policy.rules.length > 500
  ) {
    fail(code, 'Configure between one and 500 explicit billing rules');
  }
  const keys = new Set<string>();
  if (
    !Array.isArray(policy.placeOfSupplyRules) ||
    !policy.placeOfSupplyRules.length ||
    policy.placeOfSupplyRules.length > 200
  )
    fail(code, 'Approve at least one explicit place-of-supply case');
  const placeKeys = new Set<string>();
  for (const value of policy.placeOfSupplyRules) {
    const rule = object(value, code);
    knownFields(
      rule,
      [
        'key',
        'buyerType',
        'buyerStateCode',
        'context',
        'supplyStateCode',
        'basisReference',
      ],
      code,
    );
    text(rule.key, 'Place-of-supply rule key', code, 80);
    if (placeKeys.has(rule.key))
      fail(code, 'Place-of-supply rule keys must be unique');
    placeKeys.add(rule.key);
    choice(rule.buyerType, BUYER_TYPES, 'Place-of-supply buyer type', code);
    if (!(policy.buyerModes as string[]).includes(rule.buyerType as string))
      fail(code, 'Place-of-supply buyer type must be enabled');
    state(rule.buyerStateCode, code);
    state(rule.supplyStateCode, code);
    choice(
      rule.context,
      ['AT_CENTER', 'PICKUP_DROP', 'FLEET', 'OFFSITE'],
      'Service context',
      code,
    );
    text(rule.basisReference, 'Approved place-of-supply basis', code, 500);
  }
  for (const value of policy.rules) {
    const rule = object(value, code);
    knownFields(
      rule,
      [
        'key',
        'kind',
        'classificationCode',
        'treatment',
        'rateBps',
        'priceMode',
      ],
      code,
    );
    text(rule.key, 'Billing rule key', code, 100);
    if (!/^[A-Za-z0-9._:-]+$/.test(rule.key) || keys.has(rule.key)) {
      fail(code, 'Billing rule keys must be unique safe identifiers');
    }
    keys.add(rule.key);
    choice(rule.kind, KINDS, 'Billing rule kind', code);
    choice(rule.treatment, TREATMENTS, 'Tax treatment', code);
    choice(rule.priceMode, PRICE_MODES, 'Price mode', code);
    if (
      typeof rule.classificationCode !== 'string' ||
      !/^(?:\d{4}|\d{6}|\d{8})$/.test(rule.classificationCode)
    ) {
      fail(
        code,
        'Provide an explicit four, six or eight-digit HSN/SAC classification',
      );
    }
    if (
      !Number.isSafeInteger(rule.rateBps) ||
      (rule.rateBps as number) < 0 ||
      (rule.rateBps as number) > 10000
    ) {
      fail(
        code,
        'Provide an explicit integer tax rate between zero and 10000 basis points',
      );
    }
    if (rule.treatment !== 'TAXABLE' && rule.rateBps !== 0)
      fail(code, 'Exempt and non-GST rules cannot collect tax');
    if (
      seller.registrationStatus !== 'REGULAR' &&
      (rule.treatment === 'TAXABLE' || rule.rateBps !== 0)
    ) {
      fail(code, 'Composition and unregistered sellers cannot collect GST');
    }
  }
}

export function validateBuyer(
  value: unknown,
  policy?: BillingPolicy,
): asserts value is Buyer {
  const code = 'BILLING_BUYER_INVALID';
  const buyer = object(value, code);
  knownFields(
    buyer,
    ['type', 'name', 'address', 'pin', 'stateCode', 'gstin'],
    code,
  );
  choice(buyer.type, BUYER_TYPES, 'Buyer type', code);
  text(buyer.name, 'Buyer billing name', code, 255);
  text(buyer.address, 'Buyer billing address', code, 2000);
  state(buyer.stateCode, code);
  pin(buyer.pin, code);
  if (buyer.type === 'BUSINESS') {
    gstin(buyer.gstin, buyer.stateCode, code);
  } else if (buyer.gstin !== undefined) {
    fail(code, 'Choose the business buyer path before supplying a GSTIN');
  }
  if (policy && !policy.buyerModes.includes(buyer.type as BillingBuyerType)) {
    fail(
      'BILLING_BUYER_MODE_UNAVAILABLE',
      'This seller has not enabled the requested buyer type',
    );
  }
}

function paise(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) {
    fail(
      'BILLING_AMOUNT_INVALID',
      `${field} must be a nonnegative INR decimal with at most two decimal places`,
    );
  }
  const [whole, fractional = ''] = value.split('.');
  return bounded(BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0')));
}

function bounded(value: bigint): bigint {
  if (value < 0n || value > MAX_PAISE)
    fail(
      'BILLING_AMOUNT_OVERFLOW',
      'Invoice amounts exceed the supported monetary range',
    );
  return value;
}

function money(value: bigint): string {
  bounded(value);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

function rounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function quantity(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{1,8}(?:\.\d{1,6})?$/.test(value) ||
    !/[1-9]/.test(value)
  ) {
    fail(
      'BILLING_QUANTITY_INVALID',
      'Quantity must be positive with at most eight whole and six decimal digits',
    );
  }
}

/**
 * Pure calculation over approved source amounts. No rate, classification or
 * buyer lane is inferred. The caller checks the approved policy date/status.
 * Each line rounds half-up to paise once. Inclusive tax is the gross less its
 * rounded net base. Intra-state tax splits that saved total, with any odd paisa
 * assigned to SGST, so components always reconcile to the line and document.
 */
export function calculateInvoice(
  policy: BillingPolicy,
  buyer: Buyer,
  input: InvoiceCalculationLineInput[],
  supply?: SupplySelection,
): InvoiceCalculation {
  validatePolicy(policy);
  validateBuyer(buyer, policy);
  const placeRule = policy.placeOfSupplyRules.find(
    (rule) => rule.key === supply?.ruleKey,
  );
  if (
    !supply ||
    !placeRule ||
    placeRule.context !== supply.context ||
    placeRule.buyerType !== buyer.type ||
    placeRule.buyerStateCode !== buyer.stateCode
  )
    fail(
      'BILLING_PLACE_OF_SUPPLY_REQUIRED',
      'Choose an approved place-of-supply case matching this buyer and service context',
    );
  const placeOfSupply = {
    context: placeRule.context,
    ruleKey: placeRule.key,
    stateCode: placeRule.supplyStateCode,
    basisReference: placeRule.basisReference,
  };
  if (!Array.isArray(input) || !input.length || input.length > 1000) {
    fail(
      'BILLING_LINES_INVALID',
      'The invoice needs between one and 1000 approved charge lines',
    );
  }
  const rules = new Map(policy.rules.map((rule) => [rule.key, rule]));
  const ids = new Set<string>();
  let subtotal = 0n;
  let taxes = 0n;
  let total = 0n;
  const lines = input.map((value): CalculatedInvoiceLine => {
    const line = object(value, 'BILLING_LINE_INVALID');
    text(line.id, 'Source line ID', 'BILLING_LINE_INVALID', 100);
    if (ids.has(line.id))
      fail('BILLING_LINE_DUPLICATE', 'A source line cannot be charged twice');
    ids.add(line.id);
    text(line.description, 'Line description', 'BILLING_LINE_INVALID', 255);
    choice(line.kind, KINDS, 'Source line kind', 'BILLING_LINE_INVALID');
    quantity(line.quantity);
    const unitPrice = paise(line.unitPriceInr, 'Unit price');
    const originalAmount = paise(line.amountInr, 'Approved line amount');
    let amount = originalAmount;
    const [wholeQuantity, fractionalQuantity = ''] = line.quantity.split('.');
    const quantityScale = 10n ** BigInt(fractionalQuantity.length);
    const scaledQuantity =
      BigInt(wholeQuantity) * quantityScale + BigInt(fractionalQuantity || '0');
    if (rounded(unitPrice * scaledQuantity, quantityScale) !== originalAmount)
      fail(
        'BILLING_LINE_AMOUNT_MISMATCH',
        `Review charge line ${line.id}: quantity × unit price must equal its saved amount after rounding to one paisa`,
      );
    if (typeof line.ruleKey !== 'string')
      fail(
        'BILLING_CLASSIFICATION_REQUIRED',
        'Choose an approved rule for every charge line',
      );
    const rule = rules.get(line.ruleKey);
    if (!rule || rule.kind !== line.kind)
      fail(
        'BILLING_CLASSIFICATION_REQUIRED',
        'The selected rule must classify this charge line kind',
      );
    if (
      line.scope !== undefined &&
      (!Array.isArray(line.scope) || line.scope.length > 1000)
    ) {
      fail(
        'BILLING_LINE_INVALID',
        'Explanatory package scope must be an array',
      );
    }
    let scope: unknown[] | undefined;
    if (line.scope !== undefined) {
      try {
        // A JSON snapshot must reject values that JSON would silently discard
        // or change (and must not carry a cycle through to a later DB write).
        scope = JSON.parse(
          JSON.stringify(line.scope, (_key, value: unknown) => {
            if (
              value === undefined ||
              typeof value === 'bigint' ||
              typeof value === 'function' ||
              typeof value === 'symbol' ||
              (typeof value === 'number' && !Number.isFinite(value))
            ) {
              throw new Error('Non-JSON package scope');
            }
            return value;
          }),
        ) as unknown[];
      } catch {
        fail(
          'BILLING_LINE_INVALID',
          'Package scope must contain serializable values',
        );
      }
    }
    const discount =
      line.discountInr === undefined ? 0n : paise(line.discountInr, 'Discount');
    if (discount > 0n) {
      if (!policy.discounts)
        fail(
          'BILLING_DISCOUNT_POLICY_REQUIRED',
          'This center has no approved discount policy',
        );
      text(
        line.discountReason,
        'Discount reason',
        'BILLING_DISCOUNT_INVALID',
        300,
      );
      if (
        discount > originalAmount ||
        discount * 10000n > originalAmount * BigInt(policy.discounts.maxBps)
      )
        fail(
          'BILLING_DISCOUNT_LIMIT',
          'The discount exceeds the approved line limit',
        );
      amount -= discount;
    } else if (
      line.discountReason !== undefined &&
      typeof line.discountReason !== 'string'
    )
      fail('BILLING_DISCOUNT_INVALID', 'Discount reason must be text');
    const rate = BigInt(rule.rateBps);
    const net =
      rule.treatment === 'TAXABLE' && rule.priceMode === 'INCLUSIVE'
        ? rounded(amount * 10000n, 10000n + rate)
        : amount;
    const tax =
      rule.treatment !== 'TAXABLE'
        ? 0n
        : rule.priceMode === 'INCLUSIVE'
          ? amount - net
          : rounded(net * rate, 10000n);
    const lineTotal = bounded(net + tax);
    const interstate = policy.seller.stateCode !== placeRule.supplyStateCode;
    const cgst = interstate ? 0n : tax / 2n;
    const sgst = interstate ? 0n : tax - cgst;
    const igst = interstate ? tax : 0n;
    subtotal = bounded(subtotal + net);
    taxes = bounded(taxes + tax);
    total = bounded(total + lineTotal);
    return {
      id: line.id,
      kind: line.kind as BillingLineKind,
      description: line.description,
      quantity: line.quantity,
      unitPriceInr: money(unitPrice),
      amountInr: money(originalAmount),
      ...(discount > 0n
        ? {
            discountInr: money(discount),
            discountReason: line.discountReason,
          }
        : {}),
      ...(scope === undefined ? {} : { scope }),
      ruleKey: line.ruleKey,
      classificationCode: rule.classificationCode,
      treatment: rule.treatment,
      netInr: money(net),
      taxableInr: money(rule.treatment === 'TAXABLE' ? net : 0n),
      cgstInr: money(cgst),
      sgstInr: money(sgst),
      igstInr: money(igst),
      taxInr: money(tax),
      totalInr: money(lineTotal),
      rateBps: rule.rateBps,
      priceMode: rule.priceMode,
    };
  });
  return {
    placeOfSupply,
    lines,
    subtotalInr: money(subtotal),
    taxInr: money(taxes),
    totalInr: money(total),
  };
}
