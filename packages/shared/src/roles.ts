export type Role = 'owner' | 'server_admin' | 'mission_lead' | 'viewer';

export const ROLES: readonly Role[] = ['owner', 'server_admin', 'mission_lead', 'viewer'];

/**
 * Fine-grained capabilities. Backend middleware enforces these; the frontend
 * only uses them to hide controls the API would reject anyway.
 */
export type Capability =
  | 'server.view'
  | 'server.power.start'
  | 'server.power.stop'
  | 'server.power.restart'
  | 'mods.manage'
  | 'config.edit'
  | 'logs.sync'
  | 'ops.health.view'
  | 'users.manage'
  | 'settings.view';

const VIEW_ONLY: Capability[] = ['server.view'];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: [
    'server.view',
    'server.power.start',
    'server.power.stop',
    'server.power.restart',
    'mods.manage',
    'config.edit',
    'logs.sync',
    'ops.health.view',
    'users.manage',
    'settings.view',
  ],
  server_admin: [
    'server.view',
    'server.power.start',
    'server.power.stop',
    'server.power.restart',
    'mods.manage',
    'config.edit',
    'ops.health.view',
  ],
  mission_lead: ['server.view', 'server.power.restart'],
  viewer: VIEW_ONLY,
};

export function roleHasCapability(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  server_admin: 'Server Admin',
  mission_lead: 'Mission Lead',
  viewer: 'Viewer',
};
