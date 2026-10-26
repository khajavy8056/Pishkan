export interface AuthUser {
  id: string;
  kind: 'customer' | 'staff' | 'admin';
  roleCode: string | null;
  roleName: string | null;
  fullName: string;
  mobile: string | null;
  email: string | null;
  username: string | null;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  permissions: string[] | '*';
}
