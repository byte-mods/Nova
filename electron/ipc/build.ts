/**
 * IPC for the Build tool window.
 *
 * Task *execution* deliberately does not live here: it goes through the
 * existing terminal, so a build streams its output where the user already looks
 * for build output and can be interrupted the same way. This module only reads.
 */
import { ipcMain } from 'electron'
import type { BuildProject, BuildTask, DependencyNode } from '../../shared/build'
import { detectBuildProjects, loadDependencies, loadGradleTasks } from '../lib/buildTools'

export function registerBuildHandlers() {
  ipcMain.handle('build:detect', (_e, root: string): Promise<BuildProject[]> => detectBuildProjects(root))

  ipcMain.handle(
    'build:tasks',
    async (_e, root: string, project: BuildProject): Promise<BuildTask[]> => {
      // Only Gradle needs the tool run to enumerate tasks; everything else has
      // already read them from its build file during detection.
      if (project.tool !== 'gradle') return project.tasks
      return loadGradleTasks(root, project.command)
    },
  )

  ipcMain.handle(
    'build:dependencies',
    (_e, root: string, project: BuildProject): Promise<DependencyNode[]> =>
      loadDependencies(root, project),
  )
}
