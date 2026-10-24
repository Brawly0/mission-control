import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Bot,
  CalendarClock,
  CheckCheck,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  Gauge,
  Inbox,
  KeyRound,
  ListOrdered,
  MessagesSquare,
  RotateCcw,
  Settings2,
  Sunrise,
  X
} from 'lucide-react'
import type { Digest } from '@shared/types'
import { formatShare } from '@shared/planCost'
import { resetsIn } from '@shared/planUsage'
import type { InboxItem, ShownItem } from '../inbox'
import { basename, formatCost, timeAgo } from '../util'
import { useLook } from '../projectLook'
import { usePlanRate, rateExplainer } from '../planRate'
import { Avatar, Button, IconButton, Segmented } from './ui'

interface Props {
  visible: boolean
  /** What to list; with "show dismissed", dismissed ones come marked hidden. */
  items: ShownItem[]
  /** How many dismissed items are hidden right now. */
  hiddenCount: number
  showHidden: boolean
  onToggleHidden: () => void
  onAction: (item: InboxItem) => void
  onSecondary: (item: InboxItem) => void
  onDismiss: (key: string) => void
  onDismissAll: () => void
  /** Index run time: the digest reloads when new chats were read. */
  indexRun: number
  digestTime: string
  onDigestSettings: () => void
  onOpenProject: (path: string) => void
  onOpenSession: (projectPath: string, sessionId: string) => void
  onOpenTask: (id: string) => void
}

const ICONS: Record<InboxItem['kind'], typeof Bot> = {
  agent: Bot,
  review: ClipboardCheck,
  failed: AlertTriangle,
  due: CalendarClock,
  limit: Gauge,
  budget: CircleDollarSign,
  update: Download,
  queue: ListOrdered,
  restore: RotateCcw,
  login: KeyRound
}

const SECTIONS: { severity: InboxItem['severity']; label: string }[] = [
  { severity: 'urgent', label: 'Needs you now' },
  { severity: 'normal', label: 'Waiting on you' },
  { severity: 'info', label: 'Good to know' }
]

function ItemRow({ item, hidden, onAction, onSecondary, onDismiss }: { item: InboxItem; hidden: boolean; onAction: () => void; onSecondary: () => void; onDismiss: () => void }) {
  const look = useLook()
  const Icon = ICONS[item.kind]
  const project = item.projectPath ? look(item.projectPath) : undefined
  return (
    <li className={`inbox-item sev-${item.severity} ${hidden ? 'is-hidden' : ''}`}>
      <span className={`inbox-icon kind-${item.kind}`}>
        <Icon size={16} />
      </span>
      <button className="inbox-body" onClick={onAction}>
        <span className="inbox-title">
          <span className="ellipsis">{item.title}</span>
          {item.at > 0 && <span className="muted small inbox-when">{timeAgo(item.at)}</span>}
        </span>
        <span className="inbox-detail">{item.detail}</span>
        {item.projectPath && (
          <span className="inbox-project muted small">
            <Avatar name={project?.name ?? basename(item.projectPath)} path={item.projectPath} size={14} />
            {project?.name ?? basename(item.projectPath)}
          </span>
        )}
      </button>
      <span className="inbox-actions">
        {item.secondary && (
          <Button size="sm" onClick={onSecondary}>
            {item.secondary.label}
          </Button>
        )}
        <Button size="sm" variant={item.severity === 'urgent' ? 'primary' : 'secondary'} onClick={onAction}>
          {item.actionLabel}
        </Button>
        {item.dismissable && !hidden && <IconButton icon={X} label="Dismiss until something new happens" size={14} onClick={onDismiss} />}
      </span>
    </li>
  )
}

/** Yesterday (or today so far) in review: usage and its share of your week, busiest projects and chats, what's waiting now. */
function DigestCard({ indexRun, visible, digestTime, onSettings, onOpenProject, onOpenSession, onOpenTask }: Pick<Props, 'indexRun' | 'visible' | 'digestTime' | 'onOpenProject' | 'onOpenSession' | 'onOpenTask'> & { onSettings: () => void }) {
  const look = useLook()
  const rate = usePlanRate()
  const [which, setWhich] = useState<'yesterday' | 'today'>(() => (new Date().getHours() < 12 ? 'yesterday' : 'today'))
  const [digest, setDigest] = useState<Digest | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!visible) return
    window.mc
      .getDigest(which)
      .then((d) => {
        setDigest(d)
        setError('')
      })
      .catch((e) => setError(String(e?.message ?? e)))
  }, [which, visible, indexRun])

  const d = digest?.label === which ? digest : null
  const dayLabel = d ? new Date(d.from).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) : ''
  const week = d?.week
  return (
    <section className="card digest-card">
      <div className="digest-head">
        <h2>
          <Sunrise size={17} /> Daily digest
        </h2>
        <Segmented<'yesterday' | 'today'>
          value={which}
          onChange={setWhich}
          options={[
            { value: 'yesterday', label: 'Yesterday' },
            { value: 'today', label: 'Today' }
          ]}
        />
      </div>
      {error && <p className="plan-error small">{error}</p>}
      {!d && !error && <p className="muted small">Loading…</p>}
      {d && (
        <>
          <p className="muted small digest-day">
            {dayLabel}
            {which === 'today' ? ' so far' : ''}
          </p>
          <div className="digest-stats">
            <div>
              <span className="digest-value">{d.chats}</span>
              <span className="muted small">{d.chats === 1 ? 'chat' : 'chats'} · {d.replies} replies</span>
            </div>
            <div title={rate ? rateExplainer(rate) : 'Shows once Mission Control has saved enough plan readings to compare with your chats (usually a day or two).'}>
              <span className="digest-value">{d.weekShare !== undefined ? `≈${formatShare(d.weekShare)}` : '–'}</span>
              <span className="muted small">of your week · {formatCost(d.costUsd)} API</span>
            </div>
            <div>
              <span className="digest-value">{d.tasksFinished}</span>
              <span className="muted small">
                tasks finished{d.tasksFailed ? <span className="digest-bad"> · {d.tasksFailed} with problems</span> : ''}
              </span>
            </div>
            <div>
              <span className="digest-value">{d.briefings}</span>
              <span className="muted small">{d.briefings === 1 ? 'briefing' : 'briefings'} saved</span>
            </div>
          </div>

          {d.topProjects.length > 0 && (
            <div className="digest-list">
              <h3>Busiest projects</h3>
              {d.topProjects.slice(0, 3).map((p) => {
                const name = look(p.projectPath)?.name ?? (basename(p.projectPath) || 'Unknown folder')
                return (
                  <button key={p.projectPath} className="digest-row" onClick={() => p.projectPath && onOpenProject(p.projectPath)}>
                    <Avatar name={name} path={p.projectPath} size={18} />
                    <span className="ellipsis">{name}</span>
                    <span className="muted small">
                      {p.chats} {p.chats === 1 ? 'chat' : 'chats'} · {rate?.windows.seven_day ? `≈${formatShare(p.costUsd * rate.windows.seven_day.perUsd)} wk` : formatCost(p.costUsd)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {d.topChats.length > 0 && (
            <div className="digest-list">
              <h3>Heaviest chats</h3>
              {d.topChats.slice(0, 3).map((c) => (
                <button key={c.sessionId} className="digest-row" onClick={() => onOpenSession(c.projectPath, c.sessionId)}>
                  <MessagesSquare size={14} className="muted" />
                  <span className="ellipsis">{c.title || '(untitled chat)'}</span>
                  <span className="muted small">{rate?.windows.seven_day ? `≈${formatShare(c.costUsd * rate.windows.seven_day.perUsd)} wk` : formatCost(c.costUsd)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="digest-list">
            <h3>Right now</h3>
            {week && (
              <div className="digest-week">
                <span className="meter-track" aria-hidden>
                  <span className={`meter-fill ${week.utilization >= 0.9 ? 'high' : week.utilization >= 0.7 ? 'warn' : ''}`} style={{ width: `${Math.min(100, Math.round(week.utilization * 100))}%` }} />
                </span>
                <span className="small">
                  Week at {Math.round(week.utilization * 100)}%{week.resetsAt ? `, resets ${resetsIn(week.resetsAt, Date.now())}` : ''}
                </span>
                {week.pace && <span className="muted small digest-pace">{week.pace}</span>}
              </div>
            )}
            <p className="small digest-now">
              {d.review ? `${d.review} ${d.review === 1 ? 'task' : 'tasks'} to review` : 'Nothing to review'}
              {d.overdue ? ` · ${d.overdue} overdue` : ''}
            </p>
            {d.dueToday.map((t) => (
              <button key={t.id} className="digest-row" onClick={() => onOpenTask(t.id)}>
                <CalendarClock size={14} className="muted" />
                <span className="ellipsis">{t.title}</span>
                <span className="muted small">due {new Date(t.dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <button className="digest-foot muted small" onClick={onSettings}>
        <Bell size={12} /> {digestTime ? `Notification every day at ${digestTime}` : 'Daily notification is off'} · <Settings2 size={12} /> Change
      </button>
    </section>
  )
}

export default function InboxView(props: Props) {
  const { items } = props
  const dismissable = items.filter((i) => i.dismissable && !i.hidden)
  return (
    <div className="inbox-view scroll">
      <header className="inbox-head">
        <div>
          <h1>
            <Inbox size={22} /> Inbox
          </h1>
          <p className="muted">Everything that waits on you: agents, tasks to review, due dates, plan limits and budgets.</p>
        </div>
        <div className="inbox-head-actions">
          {props.hiddenCount > 0 && (
            <Button size="sm" onClick={props.onToggleHidden}>
              {props.showHidden ? 'Hide dismissed' : `Show dismissed (${props.hiddenCount})`}
            </Button>
          )}
          {dismissable.length > 1 && !props.showHidden && (
            <Button size="sm" icon={CheckCheck} onClick={props.onDismissAll}>
              Dismiss all
            </Button>
          )}
        </div>
      </header>
      <div className="inbox-columns">
        <div className="inbox-main">
          {items.length === 0 && (
            <div className="inbox-empty">
              <CheckCheck size={30} />
              <h2>All clear</h2>
              <p className="muted">Nothing is waiting on you. New items show up here, and the sidebar counts them.</p>
            </div>
          )}
          {SECTIONS.map(({ severity, label }) => {
            const list = items.filter((i) => i.severity === severity)
            if (!list.length) return null
            return (
              <section key={severity} className="inbox-section">
                <h2 className={`inbox-section-head sev-${severity}`}>
                  {label} <span className="count">{list.length}</span>
                </h2>
                <ul className="inbox-list">
                  {list.map((item) => (
                    <ItemRow
                      key={item.key}
                      item={item}
                      hidden={!!item.hidden}
                      onAction={() => props.onAction(item)}
                      onSecondary={() => props.onSecondary(item)}
                      onDismiss={() => props.onDismiss(item.key)}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
        <DigestCard
          visible={props.visible}
          indexRun={props.indexRun}
          digestTime={props.digestTime}
          onSettings={props.onDigestSettings}
          onOpenProject={props.onOpenProject}
          onOpenSession={props.onOpenSession}
          onOpenTask={props.onOpenTask}
        />
      </div>
    </div>
  )
}
