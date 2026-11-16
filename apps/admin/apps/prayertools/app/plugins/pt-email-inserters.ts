// Lets the site email editor hold every node the shared renderer sends in
// email (verses, videos, buttons, alignment), and adds images and blocks from
// the personal library to it.
import { registerMarketingExtensions, registerMarketingInserter } from '#marketing'
import { toEmailEditorContent, type EmailEditorChange } from '@prayertools/shared/tiptap'
import type { TiptapDoc } from '@prayertools/shared/db/schema'
import PtImagePicker from '../components/PtImagePicker.vue'
import { PtVerse } from '../utils/pt-verse'
import { PtVideo } from '../utils/pt-video'
import { PtButton } from '../utils/pt-button'
import { PtTextAlign } from '../utils/pt-text-align'

const NOTES: Record<EmailEditorChange, string> = {
  video: 'Videos show as a link in the email.',
  checklist: 'Checklists show as bullet lists.'
}

export default defineNuxtPlugin(() => {
  registerMarketingExtensions('pt', [PtVerse, PtVideo, PtButton, PtTextAlign])
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
