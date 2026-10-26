import { lazy, Suspense } from 'react'
import type { Props } from './NoteMarkdownRender'

// Loads on first use, like Md.
const NoteMarkdownRender = lazy(() => import('./NoteMarkdownRender'))

/** Markdown for notes: frontmatter as properties, [[wikilinks]] and .md links clickable, tables, heading ids for the outline. */
export default function NoteMarkdown(props: Props) {
  return (
    <Suspense fallback={<p className="md-loading">{props.text}</p>}>
      <NoteMarkdownRender {...props} />
    </Suspense>
  )
}
