import { createElement, useMemo, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { NoBrand } from '../brand/brandText'
import { headings, parseFrontmatter, wikilinksToMarkdown } from '@shared/vault'

export interface Props {
  text: string
  /** A note link was clicked: a [[wikilink]] name or a relative .md path. Without it, links render as text. */
  onLink?: (target: string) => void
  /** Whether a link target exists; missing ones are shown dimmed, like Obsidian. */
  exists?: (target: string) => boolean
}

const KEEP = new Set(['title'])

/** Markdown for notes: frontmatter as properties, [[wikilinks]] and .md links clickable, tables, heading ids for the outline. */
export default function NoteMarkdown({ text, onLink, exists }: Props) {
  const { props, body } = useMemo(() => parseFrontmatter(text), [text])
  const source = useMemo(() => wikilinksToMarkdown(body), [body])
  const slugs = useMemo(() => headings(body).map((h) => h.slug), [body])
  // Headings render in source order, so the n-th heading gets the n-th slug.
  let next = 0
  const heading = (level: number) =>
    function H({ children }: { children?: ReactNode }) {
      return createElement(`h${level}`, { id: slugs[next++] }, children)
    }
  const entries = Object.entries(props).filter(([k]) => !KEEP.has(k))

  return (
    <NoBrand>
      {entries.length > 0 && (
        <div className="note-props">
          {entries.map(([k, v]) => (
            <div key={k} className="note-prop">
              <span className="note-prop-key">{k}</span>
              <span className="note-prop-value">
                {(Array.isArray(v) ? v : [v]).map((x, i) => (
                  <span key={i} className={k === 'tags' || k === 'tag' ? 'note-tag' : 'note-chip'}>
                    {k === 'tags' || k === 'tag' ? `#${x.replace(/^#/, '')}` : x}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith('mc-note:') ? url : defaultUrlTransform(url))}
        components={{
          h1: heading(1),
          h2: heading(2),
          h3: heading(3),
          h4: heading(4),
          a({ href = '', children }) {
            const note = href.startsWith('mc-note:') ? decodeURIComponent(href.slice(8)) : !/^[a-z]+:/i.test(href) && /\.md(#.*)?$/i.test(href) ? href.replace(/#.*$/, '') : null
            if (note !== null) {
              const ok = exists ? exists(note) : true
              return (
                <a
                  href="#"
                  className={`note-link ${ok ? '' : 'missing'}`}
                  title={ok ? note : `${note} (no such note yet)`}
                  onClick={(e) => {
                    e.preventDefault()
                    if (ok) onLink?.(note)
                  }}
                >
                  {children}
                </a>
              )
            }
            if (href.startsWith('#')) {
              return (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  {children}
                </a>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          }
        }}
      >
        {source}
      </Markdown>
    </NoBrand>
  )
}
