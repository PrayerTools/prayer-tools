import { brandColor, brandForeground } from '@prayertools/shared/colors'

const PLATFORM_COLOR = '#c45100'

// Primary colour for Prayer.Tools' own pages (home, My prayer), readable on the current light or dark background.
export function usePlatformTheme() {
  const mode = useColorMode()
  return computed(() => ({
    '--ui-text-inverted': brandColor(PLATFORM_COLOR).textColor,
    '--ui-primary': brandForeground(PLATFORM_COLOR, mode.value === 'dark' ? '#202c3a' : '#ffffff')
  }))
}
