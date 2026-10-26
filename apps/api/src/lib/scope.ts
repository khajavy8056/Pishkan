/** Office visibility is a role decision, never inferred from broad case permissions. */
export function officeScope(auth: any): boolean {
 return auth?.permissions === '*' || ['super_admin','manager','accountant'].includes(auth?.user?.roleCode);
}
