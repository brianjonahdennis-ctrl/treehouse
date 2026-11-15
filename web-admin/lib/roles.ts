export type Role = 'super_admin' | 'admin' | 'moderator' | 'editor' | 'analyst';
export type Need = 'view' | 'moderate' | 'content' | 'manage' | 'super';
export type Me = { role: Role; can_publish: boolean; handle: string; mfa: boolean };

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin', admin: 'Admin', moderator: 'Moderator', editor: 'Editor', analyst: 'Analyst',
};

export const ROLE_HELP: Record<Role, string> = {
  super_admin: 'Everything, including staff, deleting accounts and opening any chat (with a reason).',
  admin: 'Moderation, members (with emails), rooms, ads, referrals, settings and the audit log.',
  moderator: 'Reports, members, room bans and reported chats.',
  editor: 'Announcements and ads.',
  analyst: 'Dashboard and results only.',
};

export function allows(role: Role | undefined, need: Need): boolean {
  if (!role) return false;
  switch (need) {
    case 'view': return true;
    case 'moderate': return role === 'super_admin' || role === 'admin' || role === 'moderator';
    case 'content': return role === 'super_admin' || role === 'admin' || role === 'editor';
    case 'manage': return role === 'super_admin' || role === 'admin';
    case 'super': return role === 'super_admin';
  }
}

export type Section = { id: string; label: string; icon: string; need: Need; group: 'main' | 'grow' | 'admin' };

export const SECTIONS: Section[] = [
  { id: '', label: 'Overview', icon: 'home', need: 'view', group: 'main' },
  { id: 'reports', label: 'Reports', icon: 'flag', need: 'moderate', group: 'main' },
  { id: 'members', label: 'Members', icon: 'users', need: 'moderate', group: 'main' },
  { id: 'rooms', label: 'Chatrooms', icon: 'chat', need: 'view', group: 'main' },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone', need: 'view', group: 'grow' },
  { id: 'ads', label: 'Ads', icon: 'ad', need: 'view', group: 'grow' },
  { id: 'referrals', label: 'Referrals', icon: 'gift', need: 'view', group: 'grow' },
  { id: 'settings', label: 'Settings', icon: 'gear', need: 'view', group: 'admin' },
  { id: 'staff', label: 'Staff', icon: 'shield', need: 'view', group: 'admin' },
  { id: 'audit', label: 'Audit log', icon: 'list', need: 'manage', group: 'admin' },
];
