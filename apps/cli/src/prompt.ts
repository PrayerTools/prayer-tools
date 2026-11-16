import { createInterface } from 'node:readline/promises'
import { CliError } from './auth'

// Asks a yes/no question; `yes` answers it. Without a terminal there is no one
// to ask, so the caller must pass --yes.
export async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true
  if (!process.stdin.isTTY) throw new CliError(`${question.trim()}\nNo terminal to confirm in; pass --yes.`)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}
