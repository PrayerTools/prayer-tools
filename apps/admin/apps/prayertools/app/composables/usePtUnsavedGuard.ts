// Keeps unsaved edits from being lost: leaving the page or changing its query
// (e.g. ?tab=) asks to discard them first, and closing the browser tab shows
// the browser's own prompt. Returns `allow()` for in-page switches that would
// also lose the edits; it resolves true once there is nothing left to lose.
export function usePtUnsavedGuard(dirty: () => boolean, discard: () => void) {
  const confirmAction = useConfirm()

  async function allow(): Promise<boolean> {
    if (!dirty()) return true
    const ok = await confirmAction({
      title: 'Discard unsaved changes?',
      description: 'Your changes have not been saved.',
      confirmLabel: 'Discard changes',
      color: 'error'
    })
    if (ok) discard()
    return ok
  }

  onBeforeRouteUpdate(() => allow())
  onBeforeRouteLeave(() => allow())

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (dirty()) e.preventDefault()
  }
  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

  return allow
}
