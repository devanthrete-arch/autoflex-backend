export enum JobLineKind {
  LABOUR = 'LABOUR',
  PART = 'PART',
  FEE = 'FEE',
}

/**
 * `INCLUDED` lines are the agreed scope at check-in. Extra work enters as
 * `PENDING` under an approval and becomes `APPROVED` or `DECLINED`.
 */
export enum JobLineStatus {
  INCLUDED = 'INCLUDED',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
}

export enum PartType {
  OEM = 'OEM',
  OES = 'OES',
  LOCAL = 'LOCAL',
}

export enum JobApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  PARTIALLY_APPROVED = 'PARTIALLY_APPROVED',
  DECLINED = 'DECLINED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum DecisionChannel {
  APP = 'APP',
  PHONE = 'PHONE',
  IN_PERSON = 'IN_PERSON',
}

export enum JobMediaKind {
  PRE_CONDITION = 'PRE_CONDITION',
  INSPECTION = 'INSPECTION',
  BEFORE = 'BEFORE',
  AFTER = 'AFTER',
  PARTS = 'PARTS',
  ODOMETER = 'ODOMETER',
  COMEBACK_COMPARE = 'COMEBACK_COMPARE',
}

export enum UploadStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}
