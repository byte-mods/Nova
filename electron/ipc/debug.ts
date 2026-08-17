import { ipcMain } from 'electron'
import { DebugSession, type LaunchRequest } from '../lib/debugSession'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

export function registerDebugHandlers(ctx: Ctx) {
  const session = new DebugSession({
    onState: (state) => ctx.broadcast('debug:state', state),
    onOutput: (text, category) => ctx.broadcast('debug:output', { text, category }),
    onStopped: () => ctx.broadcast('debug:stopped', {}),
  })

  ipcMain.handle('debug:detect', (_e, force?: boolean) => session.detect(force))
  ipcMain.handle('debug:state', () => session.state())
  ipcMain.handle('debug:launch', (_e, request: LaunchRequest) => session.launch(request))
  ipcMain.handle('debug:stop', () => session.stop())
  ipcMain.handle('debug:restart', () => session.restart())

  ipcMain.handle('debug:toggleBreakpoint', (_e, file: string, line: number) =>
    session.toggleBreakpoint(file, line),
  )
  ipcMain.handle('debug:clearBreakpoints', () => session.clearBreakpoints())
  ipcMain.handle(
    'debug:updateBreakpoint',
    (_e, file: string, line: number, patch: Record<string, unknown>) =>
      session.updateBreakpoint(file, line, patch),
  )
  ipcMain.handle('debug:setRoot', (_e, root: string) => session.setProjectRoot(root))

  ipcMain.handle('debug:continue', () => session.continue_())
  ipcMain.handle('debug:next', () => session.next())
  ipcMain.handle('debug:stepIn', () => session.stepIn())
  ipcMain.handle('debug:stepOut', () => session.stepOut())
  ipcMain.handle('debug:pause', () => session.pause())
  ipcMain.handle('debug:stepBack', () => session.stepBack())

  ipcMain.handle('debug:runToLine', (_e, file: string, line: number) => session.runToLine(file, line))
  ipcMain.handle('debug:dropFrame', (_e, frameId?: number) => session.dropFrame(frameId))
  ipcMain.handle(
    'debug:setExceptionBreakpoint',
    (_e, filter: string, patch: { enabled?: boolean; condition?: string }) =>
      session.setExceptionBreakpoint(filter, patch),
  )
  ipcMain.handle(
    'debug:addDataBreakpoint',
    (_e, name: string, variablesReference: number, accessType?: 'read' | 'write' | 'readWrite') =>
      session.addDataBreakpoint(name, variablesReference, accessType),
  )
  ipcMain.handle('debug:removeDataBreakpoint', (_e, dataId: string) =>
    session.removeDataBreakpoint(dataId),
  )
  ipcMain.handle(
    'debug:setVariable',
    (_e, variablesReference: number, name: string, value: string) =>
      session.setVariable(variablesReference, name, value),
  )

  ipcMain.handle('debug:scopes', (_e, frameId: number) => session.scopes(frameId))
  ipcMain.handle('debug:variables', (_e, reference: number) => session.variables(reference))
  ipcMain.handle('debug:selectFrame', (_e, frameId: number) => session.selectFrame(frameId))
  ipcMain.handle('debug:evaluate', (_e, expression: string, frameId?: number, context?: string) =>
    session.evaluate(expression, frameId, context),
  )

  return { dispose: () => session.stop() }
}
