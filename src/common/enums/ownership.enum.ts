export enum InvoiceStatus {
  DUE = 'DUE',
  PAID = 'PAID',
  VOID = 'VOID',
}

export enum PaymentMethod {
  CASH = 'CASH',
  UPI = 'UPI',
  CARD = 'CARD',
  GATEWAY = 'GATEWAY',
}

/** Why the billed amount differs from the approved estimate. */
export enum AmountAdjustmentReason {
  DISCOUNT = 'DISCOUNT',
  GOODWILL = 'GOODWILL',
  ROUNDING = 'ROUNDING',
  EXTRA_LABOUR = 'EXTRA_LABOUR',
  PARTS_PRICE_CHANGE = 'PARTS_PRICE_CHANGE',
  OTHER = 'OTHER',
}

export enum SkippableStep {
  INSPECTION = 'INSPECTION',
  QC = 'QC',
}

export enum VaultCategory {
  RC = 'RC',
  INSURANCE = 'INSURANCE',
  PUC = 'PUC',
  DRIVING_LICENCE = 'DRIVING_LICENCE',
  INVOICE = 'INVOICE',
  WARRANTY = 'WARRANTY',
  SERVICE_RECORD = 'SERVICE_RECORD',
  OTHER = 'OTHER',
}

/** Categories that always belong to one vehicle. */
export const VEHICLE_VAULT_CATEGORIES = [
  VaultCategory.RC,
  VaultCategory.INSURANCE,
  VaultCategory.PUC,
];

export enum VerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum RecordStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum MaintenanceStatus {
  UPCOMING = 'UPCOMING',
  SNOOZED = 'SNOOZED',
  COMPLETED = 'COMPLETED',
}

export enum NotificationCategory {
  SERVICE = 'SERVICE',
  APPROVAL = 'APPROVAL',
  PAYMENT = 'PAYMENT',
  MAINTENANCE = 'MAINTENANCE',
  DOCUMENTS = 'DOCUMENTS',
  SUPPORT = 'SUPPORT',
}

export enum DeliveryChannel {
  IN_APP = 'IN_APP',
  WHATSAPP = 'WHATSAPP',
  SMS = 'SMS',
  EMAIL = 'EMAIL',
}

/** `SIMULATED` marks a message that would have gone out with a provider. */
export enum DeliveryStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  SIMULATED = 'SIMULATED',
  SKIPPED = 'SKIPPED',
}

export enum SupportCategory {
  BOOKING = 'BOOKING',
  SERVICE = 'SERVICE',
  PAYMENT = 'PAYMENT',
  ACCOUNT = 'ACCOUNT',
  APP = 'APP',
  OTHER = 'OTHER',
}

export enum SupportStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}
