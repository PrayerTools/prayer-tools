// A platform library's key names it in content packs and the CLI, so a pack
// stays matched to its library when either is renamed. Each entry keeps a hash
// of the draft a pack last wrote, so an import can tell which drafts were
// edited in the admin since.
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_library ADD COLUMN key text`.execute(db)
  await sql`CREATE UNIQUE INDEX pt_library_key ON pt_library (key) WHERE key IS NOT NULL`.execute(db)
  await sql`ALTER TABLE pt_library_entry ADD COLUMN pushed_hash text`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE pt_library_entry DROP COLUMN pushed_hash`.execute(db)
  await sql`ALTER TABLE pt_library DROP COLUMN key`.execute(db)
}
