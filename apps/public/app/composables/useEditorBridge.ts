import type { Ref } from 'vue'
import type { ViewResponse } from '~~/shared/view'

interface EditorMessage {
  source: 'pt-editor'
  type: 'draft' | 'focus'
  landing?: unknown
  description?: unknown
  branding?: unknown
  brand?: unknown
  strings?: unknown
  section?: string
  id?: string
}

// Inside the admin landing-page editor's frame: renders the editor's unsaved
// changes, outlines sections on hover and tells the editor which section was
// clicked. Links and forms do nothing in the frame.
export function useEditorBridge(view: Ref<ViewResponse | undefined>) {
  if (import.meta.server) return
  const admin = view.value?.host === 'site' ? view.value.site.editor?.adminOrigin : null
  if (!admin || window.parent === window) return
  const token = new URLSearchParams(location.search).get('pt_edit')
  let seq = 0

  function post(msg: Record<string, unknown>) {
    window.parent.postMessage({ source: 'pt-preview', ...msg }, admin!)
  }

  async function render(msg: EditorMessage) {
    const n = ++seq
    try {
      const next = await $fetch<ViewResponse>('/api/editor/view', {
        method: 'POST',
        query: { pt_edit: token },
        body: { path: location.pathname, landing: msg.landing, description: msg.description, branding: msg.branding, brand: msg.brand, strings: msg.strings }
      })
      if (n === seq) view.value = next
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 403) post({ type: 'expired' })
    }
  }

  // The selected section keeps its outline through re-renders: a style rule
  // targets it by attribute instead of a class on the element.
  let selectedStyle: HTMLStyleElement | null = null
  function selectorFor(section: string | undefined, id: string | undefined) {
    return id ? `[data-pt-custom="${CSS.escape(id)}"]` : `[data-pt-section="${CSS.escape(section ?? '')}"]`
  }
  function markSelected(selector: string) {
    selectedStyle ??= document.head.appendChild(document.createElement('style'))
    selectedStyle.textContent = `.pt-editor ${selector} { outline: 3px solid #6366f1; outline-offset: -4px; }`
  }

  function focus(msg: EditorMessage) {
    const selector = selectorFor(msg.section, msg.id)
    markSelected(selector)
    // scrollIntoView would also scroll the admin page around the frame.
    const el = document.querySelector<HTMLElement>(selector)
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: 'smooth' })
  }

  function onMessage(e: MessageEvent) {
    const msg = e.data as EditorMessage | null
    if (e.origin !== admin || msg?.source !== 'pt-editor') return
    if (msg.type === 'draft') void render(msg)
    else if (msg.type === 'focus') focus(msg)
  }

  function onClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-pt-custom], [data-pt-section]')
    if (!el) return
    const id = el.dataset.ptCustom
    const section = id ? 'custom' : el.dataset.ptSection
    markSelected(selectorFor(section, id))
    post({ type: 'select', section, id })
  }

  function onSubmit(e: Event) {
    e.preventDefault()
    e.stopPropagation()
  }

  onMounted(() => {
    document.documentElement.classList.add('pt-editor')
    window.addEventListener('message', onMessage)
    document.addEventListener('click', onClick, true)
    document.addEventListener('submit', onSubmit, true)
    post({ type: 'ready', defaults: view.value?.host === 'site' ? view.value.site.editor?.defaults : {} })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('submit', onSubmit, true)
  })
}
