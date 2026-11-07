// Dev build counterpart of ./jsx-runtime.ts.
import { Fragment, jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime'
import { brandProps } from './brandText'

export { Fragment }
export type { JSX } from 'react/jsx-dev-runtime'

type Props = Record<string, unknown>
export const jsxDEV = (type: never, props: Props, key: string | undefined, isStatic: boolean, source?: never, self?: unknown) =>
  reactJsxDEV(type, brandProps(type, props) as never, key, isStatic, source, self)
