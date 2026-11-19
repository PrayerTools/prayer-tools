// Monthly campaigns: a monthly content cadence, and monthly reminders on a day
// of the month or, when `day_of_month` is null, the first of one weekday.
import { type Kysely, sql } from 'kysely'

const CADENCE_TABLES = ['pt_campaign', 'pt_library', 'pt_site_library']

async function cadences(db: Kysely<unknown>, values: string[]): Promise<void> {
  const list = sql.join(values.map(v => sql.lit(v)))
  for (const table of CADENCE_TABLES) {
    const check = sql.id(`${table}_cadence_check`)
    await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT ${check}`.execute(db)
    await sql`ALTER TABLE ${sql.table(table)} ADD CONSTRAINT ${check} CHECK (cadence IN (${list}))`.execute(db)
  }
  await sql`ALTER TABLE pt_commitment DROP CONSTRAINT pt_commitment_frequency_check`.execute(db)
  await sql`ALTER TABLE pt_commitment ADD CONSTRAINT pt_commitment_frequency_check CHECK (frequency IN (${list}))`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await cadences(db, ['daily', 'weekly', 'monthly'])
  await sql`ALTER TABLE pt_commitment ADD COLUMN day_of_month smallint CHECK (day_of_month BETWEEN 1 AND 28)`.execute(db)
  await sql`
    ALTER TABLE pt_commitment ADD CONSTRAINT pt_commitment_monthly_day_check CHECK (
      (frequency IS DISTINCT FROM 'monthly' AND day_of_month IS NULL)
      OR (frequency = 'monthly' AND day_of_month IS NOT NULL AND cardinality(days_of_week) = 0)
      OR (frequency = 'monthly' AND day_of_month IS NULL AND cardinality(days_of_week) = 1)
    )
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_commitment DROP COLUMN day_of_month`.execute(db)
  await cadences(db, ['daily', 'weekly'])
}
