// Custom JSX runtime (see electron.vite.config.ts jsxImportSource): React's runtime, plus brand logos
// in place of the words "Claude" and "Codex" in the text of DOM elements. ADR 0037.
import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime'
import { brandProps } from './brandText'

export { Fragment }
export type { JSX } from 'react/jsx-runtime'

type Props = Record<string, unknown>
export const jsx = (type: never, props: Props, key?: string) => reactJsx(type, brandProps(type, props) as never, key)
export const jsxs = (type: never, props: Props, key?: string) => reactJsxs(type, brandProps(type, props) as never, key)
