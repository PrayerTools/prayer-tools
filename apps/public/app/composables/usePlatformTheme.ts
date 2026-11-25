import { brandColor, brandForeground } from '@prayertools/shared/colors'

const PLATFORM_COLOR = '#c45100'

// Primary colour for Prayer.Tools' own pages (home, My prayer), readable on the light or dark background.
export function usePlatformTheme() {
  return computed(() => ({
    '--ui-text-inverted': brandColor(PLATFORM_COLOR).textColor,
    '--pt-primary-light': brandForeground(PLATFORM_COLOR, '#ffffff'),
    '--pt-primary-dark': brandForeground(PLATFORM_COLOR, '#202c3a')
  }))
}
