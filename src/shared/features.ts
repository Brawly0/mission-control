/**
 * The Tasks tab is archived (ADR 0042): its board, composer, templates and shortcuts are hidden.
 * The engine in src/main/tasks.ts stays, because Docs vault builds and saved schedules still use it.
 * Set to true to bring the tab back.
 */
export const TASKS_UI = false

/** Shortcut and palette ids that only make sense with the Tasks tab. */
export const TASK_SHORTCUTS = ['newTask', 'goTasks', 'templates', 'toggleQueue']
