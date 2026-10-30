// Saves the contact form's extra questions and who is notified of new
// messages. Translators can change only the wording of existing questions.
import { randomBytes } from 'node:crypto'
import type { ContactFormField, SiteContactForm } from '@prayertools/shared/db/schema'
import { parseText, textIn } from '@prayertools/shared/translatable'
import { jsonb } from '@prayertools/shared/db/json'

const MAX_FIELDS = 5
const KINDS = ['text', 'select', 'checkbox'] as const

export default definePtHandler('pt.content.translate', async (event, tx, ctx) => {
  const b = await ptBody<{ fields?: unknown, notify_user_ids?: unknown }>(event)
  const site = await ptSite(tx)
  const current = site.contact_form as SiteContactForm
  const list = Array.isArray(b.fields) ? b.fields as Record<string, unknown>[] : []
  let next: SiteContactForm

  if (ctx.perms.has('pt.site.write' as never)) {
    if (list.length > MAX_FIELDS) ptBadRequest(`The contact form can ask up to ${MAX_FIELDS} questions.`)
    const fields: ContactFormField[] = []
    for (const f of list) {
      const kind = KINDS.find(k => k === f.kind)
      if (!kind) ptBadRequest('Choose short text, dropdown or checkbox.')
      const label = parseText(f.label)
      if (!label || !textIn(label, site.default_language).trim()) ptBadRequest('Give each question a label.')
      const options = kind === 'select' ? ptFieldOptions(f.options) : []
      if (kind === 'select' && options.length < 2) ptBadRequest('A dropdown needs at least two options.')
      const key = typeof f.key === 'string' && /^[a-z0-9]{1,16}$/.test(f.key) && !fields.some(x => x.key === f.key) ? f.key : randomBytes(4).toString('hex')
      fields.push({ key, kind, label, options, required: f.required === true })
    }
    const ids = Array.isArray(b.notify_user_ids) ? b.notify_user_ids.filter((v): v is string => typeof v === 'string') : []
    const members = new Set((await ptInboxMembers(tx, ctx.orgId)).map(m => m.id))
    const notify = [...new Set(ids)].filter(id => members.has(id))
    if (ids.length && !notify.length) ptBadRequest('Choose people who can open the inbox.')
    next = { ...(fields.length ? { fields } : {}), ...(notify.length ? { notify_user_ids: notify } : {}) }
  } else {
    const fields = (current.fields ?? []).map((f) => {
      const edit = list.find(x => x.key === f.key)
      if (!edit) return f
      const options = f.options.map(o => ({ ...o, label: parseText((Array.isArray(edit.options) ? edit.options as Record<string, unknown>[] : []).find(x => x.key === o.key)?.label) ?? o.label }))
      return { ...f, label: parseText(edit.label) ?? f.label, options }
    })
    next = { ...current, ...(fields.length ? { fields } : {}) }
  }

  await tx.updateTable('pt_site').set({ contact_form: jsonb(next) } as never).execute()
  return { form: next }
})
