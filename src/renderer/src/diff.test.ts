import { describe, expect, it } from 'vitest'
import { parseDiff } from './diff'

const diff = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 export {}
diff --git a/NOTES.md b/NOTES.md
new file
--- /dev/null
+++ b/NOTES.md
@@ -0,0 +1,1 @@
+hello`

describe('parseDiff', () => {
  it('splits files and counts lines', () => {
    const files = parseDiff(diff)
    expect(files.map((f) => [f.path, f.added, f.removed])).toEqual([
      ['src/app.ts', 2, 1],
      ['NOTES.md', 1, 0]
    ])
  })
  it('keeps hunk and context lines but drops headers', () => {
    const [app] = parseDiff(diff)
    expect(app.lines[0]).toBe('@@ -1,3 +1,4 @@')
    expect(app.lines.some((l) => l.startsWith('index') || l.startsWith('+++'))).toBe(false)
  })
  it('handles an empty diff', () => {
    expect(parseDiff('')).toEqual([])
  })
})
