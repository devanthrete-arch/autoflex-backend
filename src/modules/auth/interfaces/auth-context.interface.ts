export interface IamTokenPayload {
  sub: string;
  email?: string;
  mobile?: string;
  domainApplicationId: string;
  domainId: string;
  type: 'access' | 'refresh';
  roles?: string[];
  permissions?: string[];
  iat?: number;
  exp?: number;
}

export type ActorType = 'staff' | 'customer' | 'support' | 'finance';

export interface AuthContext {
  actorType: ActorType;
  userId: string;
  domainId: string;
  domainApplicationId: string;
  roles: string[];
  permissions: string[];
  serviceCenterId: string | null;
  staffProfileId: string | null;
  customerProfileId: string | null;
  supportAgentProfileId?: string | null;
  phone?: string;
}

export const AUTH_CONTEXT_KEY = 'authContext';
