// lib/shared/permissions.ts
export const perms = {
  note: {
    read: "note:read",
    write: "note:write",
  },
  admin: {
    viewDashboard: "admin:view_dashboard",
  },
} as const;
