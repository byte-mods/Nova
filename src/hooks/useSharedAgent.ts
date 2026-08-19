/**
 * Publishes what the agent is doing to anyone watching the share.
 *
 * A share already follows the editor, which is the right thing when a person is
 * driving. When an agent is driving, the file the editor happens to be showing
 * is close to meaningless — the interesting thing is the plan, which step it is
 * on, and what it has changed. That is what this sends.
 *
 * Derived from the store rather than pushed from the console's event handler so
 * it cannot drift: whatever the user is looking at is what viewers get, and a
 * code path that forgets to publish does not exist.
 */
import { useEffect, useRef, useState } from 'react'
import type { ShareAgentState, ShareState } from '@shared/share'
import { useStore } from '@/state/store'

/**
 * A path safe to show a viewer: relative to the project, never absolute.
 *
 * Stripping the root prefix is the normal case, but it cannot be the only case.
 * On macOS the project root resolves through a symlink — `/var` is really
 * `/private/var` — so the root the store holds and the path an edit recorded
 * can disagree by a prefix while naming the same file, and the comparison
 * silently fails. What leaks then is the presenter's home directory layout to
 * whoever they sent a link to.
 *
 * So the invariant is enforced rather than assumed: if the path is still
 * absolute after the prefix is tried, it is cut down to the last couple of
 * segments. A viewer loses a little context; the presenter loses nothing they
 * did not agree to share.
 */
function shareablePath(file: string, root: string | null): string {
  if (root && file.startsWith(root)) return file.slice(root.length).replace(/^[/\\]/, '')

  if (root) {
    // Same directory name, different prefix — the symlink case.
    const name = root.split(/[/\\]/).filter(Boolean).pop()
    if (name) {
      const at = file.indexOf(`/${name}/`)
      if (at !== -1) return file.slice(at + name.length + 2)
    }
  }

  if (!file.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(file)) return file
  return file.split(/[/\\]/).slice(-2).join('/')
}

export function useSharedAgent() {
  const plan = useStore((s) => s.plan)
  const running = useStore((s) => s.aiRunning)
  const root = useStore((s) => s.root)
  const [shareState, setShareState] = useState<ShareState>('stopped')
  const last = useRef('')

  // Tracked here rather than read from the store because the share dialog owns
  // that state and is unmounted whenever it is closed — which is most of the
  // time a share is actually live.
  useEffect(() => {
    void window.nova.share.status().then((s) => setShareState(s.state))
    return window.nova.share.onStatus((s) => setShareState(s.state))
  }, [])

  useEffect(() => {
    // Nothing is published unless a share is actually live — this must never be
    // the thing that starts one.
    if (shareState !== 'live') {
      last.current = ''
      return
    }

    const state: ShareAgentState = plan
      ? {
          active: true,
          request: plan.request,
          status: plan.status,
          steps: plan.steps.map((step) => ({ text: step.text, status: step.status })),
          edits: (plan.edits ?? []).map((edit) => ({
            path: shareablePath(edit.path, root),
            additions: edit.additions,
            deletions: edit.deletions,
          })),
          verification: plan.verification && {
            state: plan.verification.state,
            framework: plan.verification.framework,
            passed: plan.verification.passed,
            failed: plan.verification.failed,
            total: plan.verification.total,
          },
          running,
        }
      : { active: false, request: '', status: '', steps: [], edits: [], running: false }

    // The store updates on every streamed token; the viewers only care when
    // something they can see has actually changed.
    const encoded = JSON.stringify(state)
    if (encoded === last.current) return
    last.current = encoded
    void window.nova.share.agent(state)
  }, [plan, running, shareState, root])
}
