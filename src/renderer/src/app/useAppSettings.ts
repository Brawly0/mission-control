import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

/**
 * App settings (reloaded whenever the Settings dialog opens or closes), the resolved theme and the UI zoom.
 * "system" theme follows Windows' light/dark setting.
 */
export function useAppSettings(settingsOpen: boolean) {
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const reloadSettings = useCallback(() => window.mc.getSettings().then(setAppSettings).catch(() => undefined), [])
  useEffect(() => {
    void reloadSettings()
  }, [settingsOpen, reloadSettings])
  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      setAppSettings((cur) => (cur ? { ...cur, ...patch } : cur))
      await window.mc.setSettings(patch)
      await reloadSettings()
    },
    [reloadSettings]
  )

  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const theme = appSettings?.theme === 'system' ? (systemDark ? 'dark' : 'light') : (appSettings?.theme ?? 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    if (appSettings) window.mc.setZoom(appSettings.uiZoom || 1)
  }, [appSettings?.uiZoom]) // eslint-disable-line react-hooks/exhaustive-deps

  return { appSettings, saveSettings, theme }
}
