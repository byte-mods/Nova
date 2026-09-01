import { useStore } from '@/state/store'
import { basename } from '@/lib/paths'

/**
 * What the editor shows in place of a file it did not load.
 *
 * A file too large to open, or one whose bytes are not text, used to be handed
 * to the code editor anyway — as a placeholder comment in the first case and as
 * a base64 data URL in the second. Both were editable, and saving either wrote
 * what was on screen over the file. The fix is not a warning on top of an
 * editor; it is not offering an editor, which is what this is.
 */
export default function UnopenableView({ path }: { path: string }) {
  const buffer = useStore((s) => s.buffers[path])
  if (!buffer) return null

  const size = buffer.size
  const readable =
    size === undefined
      ? ''
      : size >= 1024 ** 3
        ? `${(size / 1024 ** 3).toFixed(1)} GB`
        : `${(size / 1024 ** 2).toFixed(1)} MB`

  const tooLarge = buffer.readOnlyReason === 'too-large'

  return (
    <div className="unopenable">
      <div className="unopenable-card">
        <h2>{basename(path)}</h2>
        <p>
          {tooLarge
            ? `This file is ${readable}, past the size the editor loads. Nothing was read, so nothing here can be saved over it.`
            : 'This file is not text. Nova has no editor for its format, so it is shown rather than opened.'}
        </p>
        <p className="unopenable-path">{path}</p>
      </div>
    </div>
  )
}
