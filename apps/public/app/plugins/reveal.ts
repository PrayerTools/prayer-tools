import type { Directive } from 'vue'

// v-reveal: content below the fold when the page loads rises into view as it is
// scrolled to. `v-reveal` reveals the element, `v-reveal:items` its children one
// after another, and `v-reveal:content` each block of rich text, a columns block's
// columns one after another. Nothing is hidden without JS, with reduced motion,
// or in the landing editor's preview.
type Mode = 'items' | 'content' | undefined

const STAGGER_MS = 150
const groups = new WeakMap<Element, HTMLElement[]>()
const owned = new WeakMap<HTMLElement, Element[]>()
let observer: IntersectionObserver | null = null
let enabled: boolean | null = null

function isEnabled() {
  enabled ??= typeof IntersectionObserver === 'function'
    && typeof Element.prototype.animate === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && !new URLSearchParams(location.search).has('pt_edit')
  return enabled
}

function show(items: HTMLElement[]) {
  items.forEach((el, i) => {
    const frames = el.hasAttribute('data-reveal-grow')
      ? [{ opacity: 0, scale: '0 1' }, { opacity: 1, scale: '1 1' }]
      : [{ opacity: 0, translate: '0 1.5rem' }, { opacity: 1, translate: '0 0' }]
    el.animate(frames, { duration: 700, delay: i * STAGGER_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' })
    el.removeAttribute('data-reveal-out')
  })
}

function watch(target: Element, items: HTMLElement[]) {
  for (const el of items) el.setAttribute('data-reveal-out', '')
  groups.set(target, items)
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      observer!.unobserve(entry.target)
      show(groups.get(entry.target) ?? [])
      groups.delete(entry.target)
    }
  }, { rootMargin: '0px 0px -40px 0px' })
  observer.observe(target)
}

// Each group is the element whose scrolling into view reveals it, and its items in order.
function groupsOf(el: HTMLElement, mode: Mode): [Element, HTMLElement[]][] {
  const children = (parent: Element) => [...parent.children] as HTMLElement[]
  if (mode === 'items') return [[el, children(el)]]
  if (mode === 'content') return children(el).map(block => [block, block.classList.contains('columns') ? children(block) : [block as HTMLElement]])
  return [[el, [el]]]
}

const reveal: Directive<HTMLElement> = {
  getSSRProps: () => ({}),
  mounted(el, binding) {
    if (!isEnabled()) return
    const targets: Element[] = []
    for (const [target, items] of groupsOf(el, binding.arg as Mode)) {
      if (!items.length || target.getBoundingClientRect().top <= window.innerHeight) continue
      watch(target, items)
      targets.push(target)
    }
    owned.set(el, targets)
  },
  beforeUnmount(el) {
    for (const target of owned.get(el) ?? []) {
      observer?.unobserve(target)
      groups.delete(target)
    }
    owned.delete(el)
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('reveal', reveal)
})

declare module 'vue' {
  interface ComponentCustomProperties {
    vReveal: typeof reveal
  }
}
