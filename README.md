# Nuxt base

A Nuxt layer with auth, files, logs and backups, meant to be extended by other projects.

## Dev

Setup your env file by editing the `.env.example` file and rename it to `.env`.

### Email customisation

Use the route `http://localhost:3000/dev/email/[templateId]` to see the email while you edit. You can put the locale or any parameter in the query.

## Deployment

### On your server

Create the Docker `shared-network` (`docker network create shared-network || true`).

Start the postgres and drizzle-gateway dockers from the `remote-db` folder to manage your DB.
Use the addDB script to create a new DB (`./addDB.sh {db-name} {username} {password}`).

Create a folder for your project where you will deploy the website and add your env file with the production values.

Setup nginx serve your app and your public files folder or s3 public url.

#### Serve s3 folder

```
location /files/ {
    rewrite ^/files/(.*) /object/v1/AUTH_123/bucket/$1 break;

    # 2. Proxy the S3 endpoint
    proxy_pass https://s3.pub2.infomaniak.cloud;

    # 3. Essential headers for SSL S3 connection
    proxy_set_header Host s3.pub2.infomaniak.cloud;
    proxy_ssl_server_name on;

    # Optional: Hide S3 headers for security
    proxy_hide_header x-amz-request-id;
    proxy_hide_header x-amz-id-2;
}
```

#### Server server folder

```
location /files/ {
    alias /home/debian/project/volumes/files/public/;
}
```

### On your local machine

Run `pnpm prod` to deploy the website. To deploy with another env file, run `pnpm prod -e .env.{name}`.

It builds with the `Dockerfile` and `compose.yaml` at the root of your project, or the
package's ones in `docker/` when you have none. To customise them, copy them from
`node_modules/maxibase/docker`, along with `Dockerfile.dockerignore` renamed to `.dockerignore`.

Each build is tagged `{utc-timestamp}-{commit}` and the last 5 stay on the server.

Roll back with `pnpm rollback` (the version before the live one), `pnpm rollback {tag}`, or
list what is available with `pnpm rollback --list`. Rolling back does not undo migrations.

Push your migration through SSH with `pnpm db:push-prod`.

In a project that uses the layer, these scripts run from the package, see [Scripts](#scripts).

### Run one instance

Rate limit counters and the `auth` storage that holds OTPs and email-change codes both
live in the process memory (`nitro.storage.auth` is the `memory` driver). A second
container, or node in cluster mode, gets its own copy: rate limits are multiplied by the
number of instances, and an OTP verified on the instance that did not issue it fails.

Scale up only after pointing both at shared storage — swap the `auth` storage driver for
Redis and move `enforceRateLimit`'s map to the same place.

## Backups

The `backup` task dumps the DB to `backups/` every night and uploads it to the private S3
bucket when one is configured. `clean` drops both copies past `NUXT_BACKUP_RETENTION_DAYS`.

### Encrypting them

A dump is every row you have in one portable file, so the offsite copy is worth encrypting.
Set `NUXT_BACKUP_AGE_PUBLIC_KEY` and backups become `.dump.age`, encrypted with
[age](https://github.com/FiloSottile/age).

It is public-key encryption on purpose: the server holds only the public key, so it can write
backups but cannot read any of them back, and a compromise of the app or of the bucket yields
ciphertext. Never reuse the postgres password for this, it sits in the same env as the S3
credentials, so an attacker who reaches the backups already has it.

```sh
age-keygen -o key.txt   # prints the public key, keep key.txt off the server
```

Put the `age1...` public key in the server's `.env` and store `key.txt` in a password manager
plus one offline copy. **Lose it and every backup is unrecoverable**, so restore one now to
check the whole chain works:

```sh
pnpm db:restore backups/backup-....dump.age key.txt
```

### Restoring

Backups include the schema, so restore into a database straight from `addDB.sh` (use the same user and password as the old DB):

```sh
./remote-db/postgres/addDB.sh backup
```

Then restore with `pnpm db:restore`. It restores into the `NUXT_DB` of your `.env`, or of
another env file with `-e`, so keep an env file whose `NUXT_DB` points at the new DB:

```sh
pnpm db:restore -e .env.backup backups/backup-....dump.age key.txt   # encrypted backup
pnpm db:restore -e .env.backup backups/backup-....dump               # unencrypted backup
```

To roll a database back, restore into a new one and swap the names. Stop the app first, the rename needs zero connections. Restore as the app user, or the tables end up owned by
`postgres` and the app gets `permission denied`:

```sh
psql -c "alter database app rename to old;" \
     -c "alter database backup rename to app;"
```

## Nuxt layer

This repo is published on npm as [`maxibase`](https://www.npmjs.com/package/maxibase). The
root of the repo is an example project: copy it to start a new project, then edit what you
need.

### Using it in a project

```sh
pnpm add maxibase
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['maxibase'],
})
```

### What ships in the package

| Path                   | Role                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `layers/base`          | the layer itself: pages, components, API routes, utils, shared types. Not meant to be edited                     |
| `nuxt.config.ts`       | default route rules, rate limits, i18n and head config. Your config overrides it                                 |
| `locales`              | default translations. Your `locales` files are merged on top, key by key                                         |
| `server/assets/emails` | default email templates. A template in your `server/assets/emails` replaces the package's one with the same path |
| `scripts`              | deploy, rollback and DB scripts, run from `node_modules` (see `package.json` below)                              |
| `docker`               | default `Dockerfile` and `compose.yaml` for `pnpm prod`, used when your project has none                         |

New translations, templates and config defaults in a new version reach every project with
`pnpm update maxibase`, without copying anything.

To keep a single language, disable the other one in your config:

```ts
i18n: { locales: [{ code: 'fr' }, { code: 'en', disabled: true }], defaultLocale: 'fr' }
```

### Starting a project

Copy only these files from this repo, the rest comes from the package:

| Path                                                 | Notes                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `nuxt.config.ts`                                     | replace `extends: ['./layers/base']` with `extends: ['maxibase']`             |
| `package.json`                                       | use the one below instead                                                     |
| `tsconfig.json`, `pnpm-workspace.yaml`, `.gitignore` | as they are                                                                   |
| `.env.example`                                       | fill it in and rename it to `.env`                                            |
| `drizzle.config.ts`                                  | used by the `db:*` scripts                                                    |
| `server/database/schema.ts`                          | re-exports the layer's tables, add yours below                                |
| `app/assets/css/index.css`                           | required by the `css` entry of the package config                             |
| `app/components/TheHeader.vue`, `TheFooter.vue`      | required by the `default` layout                                              |
| `app/pages/index.vue`                                | replace the example with your home page, the layer links to the `index` route |

And only if you need them:

| Path                                        | Notes                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `server/database/relations.ts`, `access.ts` | organizations, along with `server/utils/organizations.ts` and their tables |
| `server/database/seed.ts`                   | for `db:seed`                                                              |
| `.oxlintrc.json`, `.oxfmtrc.json`           | lint and format config                                                     |

Organizations come as a set: the `organizations` and `organization_members` tables in `schema.ts`,
`relations.ts`, `access.ts` and `server/utils/organizations.ts`. Keep all of them or none.

Don't copy `locales`, `server/assets/emails`, `scripts` or `docker`, they ship with the package. A
copied translation or email template replaces the package's one and stops receiving its updates,
so copy only the keys or templates you change. `layers`, `test`, `vitest.config.ts`, `remote-db`
and `.github` are for this repo only (the CI runs scripts a project's `package.json` doesn't have).

The tables of the `auth` schema ship with the layer, in `layers/base/server/database/schema.ts`.
Your `server/database/schema.ts` re-exports them and adds your own tables, so `pnpm update maxibase`
brings their changes: run `pnpm db:generate` after an update. To customise one, copy it into your
schema, a table declared in your file takes precedence over the package's one with the same name.
Their relations come from `authRelations`, merged after yours in `db.ts`, so only define relations
on your own tables.

`db.ts`, `relations.ts` and `access.ts` in `server/database` are optional, the layer has a default
for each in `layers/base/server/database/defaults`: no relations of your own, and file access to
the user's own folder `u/{id}` or to admins. Add the file to replace the default, then restart the
dev server. The migrate script is in the package too, see `db:migrate` below.

A project's `package.json` looks like this. Add any package your own files import: pnpm only lets a project import its direct dependencies.

```json
{
  "name": "my-project",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "nuxt build",
    "dev": "nuxt dev",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare",
    "prod": "bash node_modules/maxibase/scripts/deploy.sh",
    "rollback": "bash node_modules/maxibase/scripts/rollback.sh",
    "db:seed": "npx jiti ./server/database/seed.ts",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:push-prod": "bash node_modules/maxibase/scripts/db/push-server.sh",
    "db:restore": "bash node_modules/maxibase/scripts/db/restore.sh",
    "db:migrate": "npx jiti node_modules/maxibase/scripts/db/migrate.ts",
    "db:studio": "drizzle-kit studio",
    "lint": "oxlint",
    "fmt": "oxfmt",
    "typecheck": "nuxt typecheck"
  },
  "dependencies": {
    "drizzle-orm": "1.0.0-rc.3",
    "goku-css": "^9.0.8",
    "maxibase": "^1.0.0",
    "nuxt": "^4.6.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "drizzle-kit": "1.0.0-rc.3",
    "drizzle-seed": "1.0.0-rc.3",
    "oxfmt": "^0.72.0",
    "oxlint": "^1.87.0",
    "typescript": "^5.9.3",
    "vue-tsc": "^3.3.12"
  }
}
```

### Publishing a new version

The first release goes from `0.0.0` with `npm version major`, which tags it `v1.0.0`.
`prepublishOnly` runs lint, format check, typecheck and tests before anything is uploaded.

```sh
npm version patch   # or minor, or major for a change projects must adapt to
npm publish
git push --follow-tags
```

Then run `pnpm update maxibase` in each project. Projects depend on `^1.0.0`, so they only
move to a new major version when you change that range.
