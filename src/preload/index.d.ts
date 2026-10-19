import type { MissionControlApi } from '../shared/types'

declare global {
  interface Window {
    mc: MissionControlApi
  }
}
