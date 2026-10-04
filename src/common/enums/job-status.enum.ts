export enum JobStatus {
  CHECKED_IN = 'CHECKED_IN',
  INSPECTION = 'INSPECTION',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  IN_PROGRESS = 'IN_PROGRESS',
  QUALITY_CHECK = 'QUALITY_CHECK',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  COMPLETED = 'COMPLETED',
  ON_HOLD = 'ON_HOLD',
  CANCELLED = 'CANCELLED',
}

export const VALID_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  [JobStatus.CHECKED_IN]: [
    JobStatus.INSPECTION,
    JobStatus.ON_HOLD,
    JobStatus.CANCELLED,
  ],
  [JobStatus.INSPECTION]: [
    JobStatus.AWAITING_APPROVAL,
    JobStatus.IN_PROGRESS,
    JobStatus.ON_HOLD,
    JobStatus.CANCELLED,
  ],
  [JobStatus.AWAITING_APPROVAL]: [
    JobStatus.IN_PROGRESS,
    JobStatus.ON_HOLD,
    JobStatus.CANCELLED,
  ],
  [JobStatus.IN_PROGRESS]: [
    JobStatus.AWAITING_APPROVAL,
    JobStatus.QUALITY_CHECK,
    JobStatus.ON_HOLD,
    JobStatus.CANCELLED,
  ],
  [JobStatus.QUALITY_CHECK]: [
    JobStatus.READY_FOR_PICKUP,
    JobStatus.IN_PROGRESS,
    JobStatus.ON_HOLD,
    JobStatus.CANCELLED,
  ],
  [JobStatus.READY_FOR_PICKUP]: [
    JobStatus.COMPLETED,
    JobStatus.ON_HOLD,
    JobStatus.CANCELLED,
  ],
  [JobStatus.COMPLETED]: [],
  [JobStatus.ON_HOLD]: [
    JobStatus.INSPECTION,
    JobStatus.IN_PROGRESS,
    JobStatus.AWAITING_APPROVAL,
    JobStatus.QUALITY_CHECK,
    JobStatus.READY_FOR_PICKUP,
    JobStatus.CANCELLED,
  ],
  [JobStatus.CANCELLED]: [],
};
