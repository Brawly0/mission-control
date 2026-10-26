import { lazy, Suspense } from 'react'

// The Markdown renderer loads on first use, so it isn't part of startup. Until then the plain text shows.
const MdRender = lazy(() => import('./MdRender'))

/** Markdown as Claude writes it: tables, task lists and strikethrough included (GitHub flavor). */
export function Md({ children }: { children: string }) {
  return (
    <Suspense fallback={<p className="md-loading">{children}</p>}>
      <MdRender>{children}</MdRender>
    </Suspense>
  )
}
