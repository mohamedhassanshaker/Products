/** One notification channel a reviewer group is reachable on (BL-056 — v1 ships in-app/email only, SMS is BL-077, deferred). */
export interface NotificationChannelRecord {
  type: 'in_app' | 'email';
  address?: string;
}

/**
 * `ReviewerGroup` aggregate (Phase 14, BL-052; `ARCHITECTURE_NOTES.md` §6.1)
 * — R-H1's reviewer group. `members` are `AdminUser.id`s, never inlined rows
 * (mirrors `Skill.tools[]`'s by-reference convention throughout this codebase).
 */
export interface ReviewerGroupRecord {
  id: string;
  tenantId: string;
  name: string;
  members: string[];
  notificationChannels: NotificationChannelRecord[];
  createdAt: Date;
  updatedAt: Date;
}
