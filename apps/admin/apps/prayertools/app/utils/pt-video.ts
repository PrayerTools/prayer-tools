// Video block for the editor: a YouTube or Vimeo link shown as its player.
// Stored as a `youtube` node, which the shared renderer embeds for both services.
import { Node, mergeAttributes } from '@tiptap/core'
import { videoEmbed } from '@prayertools/shared/video'

export const PtVideo = Node.create({
  name: 'youtube',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null, parseHTML: el => el.getAttribute('data-src'), renderHTML: a => (a.src ? { 'data-src': a.src } : {}) }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="video"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const video = videoEmbed(node.attrs.src)
    const player = video && video.kind !== 'file'
      ? ['iframe', { src: video.src, allowfullscreen: 'true', title: 'Video', style: 'width:100%;aspect-ratio:16/9;border:0;pointer-events:none;' }]
      : ['p', {}, String(node.attrs.src ?? '')]
    return ['div', mergeAttributes({ 'data-type': 'video', 'class': 'pt-video' }, HTMLAttributes), player]
  }
})
