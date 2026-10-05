/**
 * Workshop designation shown in rosters and assignment pickers.
 * Access control comes from Frevels IAM roles and permissions on the token.
 */
export enum StaffDesignation {
  ADVISOR = 'ADVISOR',
  TECHNICIAN = 'TECHNICIAN',
  MANAGER = 'MANAGER',
  DRIVER = 'DRIVER',
}
