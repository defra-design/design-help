/**
 * Remove the prototype kit `.tmp` tree using Node's fs.rmSync (recursive).
 * Avoids ENOTEMPTY from older rimraf when deleting `.tmp/backup-nunjucks` on macOS.
 * Safe: sessions use Postgres; kit recreates `.tmp` on the next build/dev.
 */

const fs = require('fs')
const path = require('path')

const tmp = path.join(__dirname, '..', '.tmp')

if (fs.existsSync(tmp)) {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch (err) {
    console.warn('[clean-prototype-tmp]', err.message)
    process.exitCode = 1
  }
}
