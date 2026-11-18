// Every node and mark prayer content can hold beyond UEditor's starter kit and
// image. An editor missing one opens a doc that uses it as an empty doc, and
// saving then wipes the content, so every editor that opens prayer content
// takes this whole list.
import type { Extensions } from '@tiptap/core'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import { TextStyle } from '@tiptap/extension-text-style'
import { PtAudio } from './pt-audio'
import { PtButton } from './pt-button'
import { PtColor, PtHighlight } from './pt-colors'
import { PtColumn, PtColumns } from './pt-columns'
import { PtImageLink } from './pt-image-link'
import { PtTextAlign } from './pt-text-align'
import { PtVerse } from './pt-verse'
import { PtVideo } from './pt-video'

export const ptContentExtensions: Extensions = [
  PtVerse,
  PtVideo,
  PtAudio,
  PtButton,
  PtTextAlign,
  PtImageLink,
  PtColumns,
  PtColumn,
  Superscript,
  Subscript,
  TextStyle,
  PtColor,
  PtHighlight,
  TableKit.configure({ table: { resizable: false } })
]
