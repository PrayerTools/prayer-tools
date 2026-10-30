# Local development on this Windows checkout

The complete app is configured locally: PostgreSQL, Mailpit, the admin app, public site, and worker. Environment files and downloaded tools live in ignored files; no production services are connected.

## Start and stop

From the repository folder in PowerShell 7:

```powershell
pwsh -File scripts/dev-local.ps1
pwsh -File scripts/dev-local.ps1 stop
```

The starter uses the portable Bun, Node, PostgreSQL and Mailpit tools installed under `.data/local`. It keeps service logs there and starts application windows hidden. The initial installation must already exist; this command does not download dependencies or reset data.

## Open the app

- Homepage: http://localhost:3480/
- Create an account: http://localhost:2480/register
- Sign in: http://localhost:2480/login
- Create a prayer site: http://localhost:2480/orgs/new
- Local email inbox: http://localhost:8025/
- Sample campaign: http://ramadan-demo.localhost:3480/
- Sample coverage campaign: http://demo-247.localhost:3480/
- My Prayer: http://localhost:3480/my

All email is captured by Mailpit. Use its inbox to follow account and participant verification links; no real email is delivered. You may register with your own email address locally.

A development administrator was created to verify setup. Its generated credentials are in `.data/local/login.txt`. A draft site named **Local Prayer Campaign** belongs to this administrator. Other newly registered users create their own sites.

The database persists in `.data/local/pgdata`. Shared signing secrets and generated database passwords are in the ignored `.env` files. Do not commit these files or share the credentials.

## Nuxtinator dependencies

The README requires unreleased Nuxtinator features. This setup fetched Nuxtinator commit `99053949435c63ec66d3b33ac44ae6ca13a22b91` into `.data/local/nuxtinator` and copied the six required layers into ignored `apps/admin/_layers` before installing workspaces. This avoids changing the tracked layer pins. Running `bun run setup` would replace these layers with the older pinned releases.

AI translation, real push delivery, production Mailgun, custom-domain provisioning, and remote object storage require their respective external service credentials. Local signup, site and campaign creation, content, uploads to local disk, participant subscriptions, email reminders, and My Prayer use the local services.
