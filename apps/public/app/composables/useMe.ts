// What /api/me says about this browser on the current site, fetched once per
// page and shared by the components that ask. Client only.
export interface Me {
  referral_code: string | null
  email: string | null
  name: string | null
  account: { email: string, name: string | null } | null
  // Campaigns the visitor's active subscription here has prayer times in.
  campaigns: string[]
}

let pending: { path: string, promise: Promise<Me | null> } | null = null

export function fetchMe(): Promise<Me | null> {
  const path = window.location.pathname
  if (pending?.path !== path) pending = { path, promise: $fetch<Me>('/api/me').catch(() => null) }
  return pending.promise
}
