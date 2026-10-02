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

Run `./scripts/deploy.sh` to deploy the website. To deploy other env file just do `./scripts/deploy.sh {name}` and it will deploy .env.{name}.

Each build is tagged `{utc-timestamp}-{commit}` and the last 5 stay on the server.

Roll back with `pnpm rollback` (the version before the live one), `pnpm rollback {tag}`, or
list what is available with `pnpm rollback --list`. Rolling back does not undo migrations.

Push your migration with `pnpm db:push-server` or `./scripts/db/push-server.sh` to push trough SSH.

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
./scripts/db/restore.sh backups/backup-....dump.age key.txt
```

### Restoring

Backups include the schema, so restore into a database straight from `addDB.sh` (use the same user and password as the old DB):

```sh
./remote-db/postgres/addDB.sh backup
```

Set NUXT_DB to this new DB then restore.

```sh
./scripts/db/restore.sh backups/backup-....dump.age key.txt
```

To roll a database back, restore into a new one and swap the names. Stop the app first, the rename needs zero connections. Restore as the app user, or the tables end up owned by
`postgres` and the app gets `permission denied`:

```sh
psql -c "alter database app rename to old;" \
     -c "alter database backup rename to app;"
```

## Nuxt layer

Clone this repo and delete the `layers` folder or copy folders in `app` and `server` into your project. Then add `extends: [['github:maxirozay/nuxt-base']]` to your nuxt config to use this project as a layer. Check the `.env.example` and `nuxt.config.ts` to change the config.

Install the same packages as this project or uses `extends: [['github:maxirozay/nuxt-base', { install: true }]]` but this config can cause some issues during builds.

### What your project must provide

The layer's server code reaches into your project for its data layer and assets, through
Nitro's `#server` alias. None of these ship with the layer, and a missing one fails the
build with an unresolved import:

| Path                           | Must export                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `server/database/db.ts`        | `db`, a drizzle client built with your relations                                                                                         |
| `server/database/schema.ts`    | `auth`, `refreshTokens`, `credentials`, `logs` tables (plus `organizations` / `organizationMembers` if you use `server/utils/access.ts`) |
| `server/database/relations.ts` | `relations`, wiring `auth` to its refresh tokens and credentials                                                                         |
| `server/database/access.ts`    | `checkFileAccess(event, path)`, which decides who may read and write a given file path                                                   |
| `server/assets/emails/**`      | `base.html` and a `{locale}/{templateId}.html` per template you send                                                                     |
| `locales/**`                   | the translation files for the locales in your `i18n.locales`                                                                             |

Copy them from this repo as a starting point: only `access.ts` is really meant to be
rewritten per project, the rest is the schema the layer's queries expect.
