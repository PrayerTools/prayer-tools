// Opening an inbox conversation dismisses its notifications for everyone
// (core only marks the viewer's own), then refreshes the bell and rail badge.
const CONVERSATION = /^(?:\/@[^/]+)?\/inbox\/([0-9a-f-]{36})\/?$/

export default defineNuxtPlugin(() => {
  const { refresh } = useNotifications()
  useRouter().afterEach((to, _from, failure) => {
    const id = failure ? null : to.path.match(CONVERSATION)?.[1]
    if (!id) return
    $fetch<{ updated: number }>(`/api/pt/inbox/${id}/seen`, { method: 'POST' })
      .then(res => res.updated > 0 ? refresh() : undefined)
      .catch(() => {})
  })
})
