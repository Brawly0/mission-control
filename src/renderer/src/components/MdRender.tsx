import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]

/** Markdown as Claude writes it: tables, task lists and strikethrough included (GitHub flavor). */
export default function MdRender({ children }: { children: string }) {
  return <Markdown remarkPlugins={plugins}>{children}</Markdown>
}
