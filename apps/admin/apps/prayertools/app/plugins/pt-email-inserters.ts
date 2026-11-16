// Adds images and blocks from the personal library to the site email editor.
import { registerMarketingInserter } from '#marketing'
import { toEmailEditorContent, type EmailEditorChange } from '@prayertools/shared/tiptap'
import type { TiptapDoc } from '@prayertools/shared/db/schema'
import PtImagePicker from '../components/PtImagePicker.vue'
import { PtVerse } from '../utils/pt-verse'
import { PtVideo } from '../utils/pt-video'

const NOTES: Record<EmailEditorChange, string> = {
  video: 'Videos show as a link in the email.',
  button: 'Buttons show as links.',
  checklist: 'Checklists show as bullet lists.'
}

export default defineNuxtPlugin(() => {
  registerMarketingInserter({
    id: 'pt-image',
    label: 'Image',
    icon: 'i-lucide-image',
    order: 10,
    picker: {
      component: PtImagePicker,
      toInsert: (picked: { url: string, alt: string }) => ({ content: [{ type: 'image', attrs: { src: picked.url, alt: picked.alt } }] })
    }
  })
  registerMarketingInserter({
    id: 'pt-blocks',
    label: 'Blocks',
    icon: 'i-lucide-blocks',
    order: 20,
    extensions: [PtVerse, PtVideo],
    items: async () => {
      const res = await $fetch<{ blocks: { id: string, name: string, content: TiptapDoc }[] }>('/api/pt/blocks')
      return res.blocks.map(b => ({
        id: b.id,
        label: b.name,
        insert: () => {
          const { content, changes } = toEmailEditorContent(b.content.content ?? [])
          return { content, note: changes.map(c => NOTES[c]).join(' ') || undefined }
        }
      }))
    }
  })
})
