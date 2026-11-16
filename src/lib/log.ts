// Ring buffer of debug notes. In the browser console:
//   gameLog.dump()          recent lines
//   gameLog.enabled = false silence it
//   gameLog.level = 'warn'  hide debug and info
//   gameLog.clear()

const RANK = { debug: 10, info: 20, warn: 30, error: 40 }

export class Log {
  constructor(scope = 'game', root = null) {
    this.scope = scope
    this.root = root || this
    if (!root) {
      this.enabled = true
      this.level = 'debug'
      this.max = 300
      this.entries = []
    }
  }

  child(scope) {
    return new Log(`${this.scope}/${scope}`, this.root)
  }

  write(level, message, data) {
    const root = this.root
    if (!root.enabled) return
    if ((RANK[level] || 0) < (RANK[root.level] || 0)) return
    const entry = { t: Math.round(performance.now()), level, scope: this.scope, message, data }
    root.entries.push(entry)
    if (root.entries.length > root.max) root.entries.splice(0, root.entries.length - root.max)
    const line = `[${this.scope}] ${message}`
    const out = console[level] || console.log
    if (data === undefined) out(line)
    else out(line, data)
  }

  debug(message, data) { this.write('debug', message, data) }
  info(message, data) { this.write('info', message, data) }
  warn(message, data) { this.write('warn', message, data) }
  error(message, data) { this.write('error', message, data) }

  dump(count = 40) {
    const rows = this.root.entries.slice(-count)
    console.table(rows.map((e) => ({
      t: e.t,
      level: e.level,
      scope: e.scope,
      message: e.message,
      data: e.data === undefined ? '' : JSON.stringify(e.data),
    })))
    return rows
  }

  clear() {
    this.root.entries.length = 0
  }
}

export const log = new Log('game')

if (typeof window !== 'undefined') window.gameLog = log
