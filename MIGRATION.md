# Migrating to v2

v2 moves the layer to Nuxt 5 and groups every breaking change in one release.

None of the changes below need a database migration: the SQL table and column names stay the
same, `pnpm db:generate` produces nothing.

## Nuxt 5

Add `vue` and `vue-router` to your `dependencies`. Nitro v3 bundles every dependency into the
server and no longer finds them through Nuxt's.

Sessions are sealed with `NUXT_APP_SECRET`, `NUXT_SESSION_PASSWORD` is no longer read. Set it in
every env file (`openssl rand -base64 32`). The session cookies of v1 can't be opened anymore, but a
signed-in user still has a refresh token, so the next request signs them back in without them
noticing. Only their next sensitive action asks to confirm their identity again.

In `package.json`, `db:migrate` runs the script with node:

```json
"db:migrate": "node node_modules/maxibase/scripts/db/migrate.mjs"
```

Nitro reserves dotted suffixes in server file names: a middleware like `server/middleware/4.org.ts`
fails the build. Rename it `4-org.ts`. The layer's middlewares are now `0-rate-limit.ts`,
`1-session.ts`, `2-mfa.ts` and `3-admin.ts`, and still run in that order.

### Your server code

Nuxt 5 no longer auto-imports the Nitro and h3 utilities in server code. Import them from
`nuxt/server`, or enable `experimental.nitroAutoImports` while you migrate. The layer's own utils
(`db`, `log`, `requireAdmin`…) and those of nuxt-auth-utils are still auto-imported.

```ts
import { createError, defineEventHandler, readValidatedBody, useRuntimeConfig } from 'nuxt/server'
```

| v1                                           | v2                                                |
| -------------------------------------------- | ------------------------------------------------- |
| `import type { H3Event } from 'h3'`          | `import type { RequestEvent } from 'nuxt/server'` |
| `useStorage('auth')`                         | `useKV('auth')` from `nitro/kv`                   |
| `nitro.storage` in `nuxt.config`             | `nitro.kv`                                        |
| `defineNitroPlugin`                          | `definePlugin` from `nitro`                       |
| `defineTask`                                 | `defineTask` from `nitro/task`                    |
| `setHeader(event, name, value)`              | `event.res.headers.set(name, value)`              |
| `readFormData(event)`                        | `event.req.formData()`                            |
| `isMethod(event, 'GET')`                     | `event.req.method === 'GET'`                      |
| `event.path`                                 | `event.url.pathname`, without the query string    |
| `event.node.req.headers['user-agent']`       | `event.req.headers.get('user-agent')`             |
| `createError({ statusCode, statusMessage })` | `createError({ status, statusText })`             |
| `error.statusCode`                           | `error.status`                                    |

`getRouterParam` returns the parameter still URL-encoded, pass `{ decode: true }` to decode it.

The layer's utils take a `RequestEvent` instead of an `H3Event`.

### Env values

Nitro v3 gives a `NUXT_*` override to the app as the raw string, v2 parsed it: `NUXT_FORCE_MFA=false`
would be the string `"false"`, which is truthy. The layer parses them back on startup, `true` and
`false` as booleans and numbers as numbers, for your own runtime config keys too. A value that only
looks like a number, such as `007` or a long numeric id, stays a string.

## Drizzle 1.0.0-rc.5

The layer uses `drizzle-orm` `1.0.0-rc.5`. Set `drizzle-orm`, `drizzle-kit` and `drizzle-seed` to
`1.0.0-rc.5` in your `package.json`.

drizzle-kit now stores snapshots in a new format and refuses to generate against the old ones.
Upgrade your migrations folder once, it rewrites the `snapshot.json` files and leaves the
`migration.sql` files as they are:

```sh
npx drizzle-kit up
```

A relational query (`db.query.….findMany`, `findFirst`) now throws on a `where` field that is
`undefined`, where it used to skip it. Use `EmptyFilter` for a filter that is optional:

```ts
import { EmptyFilter } from 'drizzle-orm/relations'

await db.query.authLogs.findMany({ where: { type: type ?? EmptyFilter } })
```

A relation filter that is an empty object (`where: { posts: {} }`) is now skipped. Use
`posts: true` for "has at least one".

See the [rc.4](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.4) and
[rc.5](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.5) release notes for the
rest, mostly other drivers and dialects.

## Database tables

The layer's tables are exported with an `auth` prefix, so a project table of the same name, like a
`users` or `logs`, can no longer replace one of them in `server/database/schema.ts`.

| v1              | v2                  |
| --------------- | ------------------- |
| `auth`          | `authUsers`         |
| `refreshTokens` | `authRefreshTokens` |
| `credentials`   | `authCredentials`   |
| `recoveryCodes` | `authRecoveryCodes` |
| `logs`          | `authLogs`          |

The relation from a refresh token, credential, recovery code or log to its user is `user`, not
`auth`. The user's own relations keep their names (`credentials`, `refreshTokens`,
`recoveryCodes`).

```ts
// v1
import { auth } from 'maxibase/layers/base/server/database/schema'
await db.query.auth.findFirst({ where: { id } })
await db.query.logs.findMany({ with: { auth: true } })

// v2
import { authUsers } from 'maxibase/layers/base/server/database/schema'
await db.query.authUsers.findFirst({ where: { id } })
await db.query.authLogs.findMany({ with: { user: true } })
```

A `relations.ts` entry that overrides one of these tables uses its new key, e.g. `authLogs: { … }`.

`GET /api/admin/logs` returns each log's user as `user`, not `auth`.

## Users

| v1                                                  | v2                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `getAuth(event)`, `getAuth(event, undefined, true)` | `requireAuthUser(event)`, `requireAuthUser(event, { withCredentials: true })`           |
| `getAuth(event, email, true)`                       | `findAuthUserByEmail(email, { withCredentials: true })`, `undefined` when there is none |
| `createAuth({ email }, event)`                      | `createAuthUser(event, { email })`, without an email the user is anonymous              |
| `setAuth({ id, email })`                            | `setAuthUserEmail(id, email)`                                                           |
| `setSession(event, user, false)`                    | `setSession(event, user, { refresh: false })`                                           |
| `revokeExpiredRefreshToken(date)`                   | `cleanRefreshTokens()`, the nightly `clean` task runs it                                |

`requireAuthUser` still throws a 401 without a session and a 404 when the user is gone.
`findAuthUserByEmail` no longer throws, so drop the `.catch` that turned its 404 into `null`:

```ts
// v1
const user = await getAuth(event, email).catch((error) => {
  if (error.statusCode === 404) return null
  throw error
})

// v2
const user = await findAuthUserByEmail(email)
```

## Access checks

The helpers that throw instead of returning `false` are named `require*`, and return what they
checked instead of `true`.

| v1                                    | v2                                                               |
| ------------------------------------- | ---------------------------------------------------------------- |
| `isAdmin(event)`                      | `requireAdmin(event)`, returns the session                       |
| `getOrganizationMember(event, orgId)` | `requireOrganizationMember(event, orgId)`                        |
| `isOrganizationMember(event, orgId)`  | `requireOrganizationMember(event, orgId)`                        |
| `isOrganizationAdmin(event, orgId)`   | `requireOrganizationAdmin(event, orgId)`, returns the membership |

The organization helpers live in your copy of `server/utils/organizations.ts` and
`server/database/access.ts`: update them from this repo.

## Options objects

Functions with many parameters take an options object. The main value stays first.

```ts
// v1
await log('Email changed', { from, to }, undefined, 'security', event)
await sendEmailTemplate('otp', locale, { otp }, email)

// v2
await log('Email changed', { data: { from, to }, type: 'security', event })
await sendEmailTemplate('otp', { to: email, locale, params: { otp } })
```

### Server

| v1                                                                                   | v2                                                                                       |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `log(summary, data, origin, type, event)`                                            | `log(summary, { data, origin, type, event })`                                            |
| `sendEmail(to, subject, html, locale, attachments, bcc, params, replyTo, smtp)`      | `sendEmail({ to, subject, html, locale, params, attachments, bcc, replyTo, smtp })`      |
| `sendEmailTemplate(templateId, locale, params, to, attachments, bcc, replyTo, smtp)` | `sendEmailTemplate(templateId, { to, locale, params, attachments, bcc, replyTo, smtp })` |
| `uploadFile(event, file, path, isPrivate, maxAge)`                                   | `uploadFile(event, file, { path, isPrivate, maxAge })`                                   |
| `uploadStream(event, file, path, isPrivate, maxAge)`                                 | `uploadStream(event, file, { path, isPrivate, maxAge })`                                 |
| `getFile(event, path, isPrivate, expireIn, redirect)`                                | `getFile(event, path, { isPrivate, expireIn, redirect })`                                |
| `listFolder(event, path, isPrivate)`                                                 | `listFolder(event, path, { isPrivate })`                                                 |
| `deletePath(event, path, isPrivate)`                                                 | `deletePath(event, path, { isPrivate })`                                                 |
| `copyFile(event, src, dest, isPrivate, deleteSrc)`, same for `copyFiles`             | `copyFile(event, src, dest, { isPrivate, deleteSrc })`                                   |
| `createDatabaseBackup(name, dbUrl, dumpArgs, agePublicKey)`                          | `createDatabaseBackup(name, { dbUrl, dumpArgs, agePublicKey })`                          |

The S3 helpers take their options last, and `cache` is now `cacheControl`. `contentType` defaults to
`application/octet-stream`.

| v1                                                             | v2                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `uploadToS3(key, body, contentType, cache, isPrivate)`         | `uploadToS3(key, body, { contentType, cacheControl, isPrivate })`        |
| `uploadStreamToS3(key, body, contentType, cache, isPrivate)`   | `uploadStreamToS3(key, body, { contentType, cacheControl, isPrivate })`  |
| `initMultipartUploadToS3(key, contentType, isPrivate, cache)`  | `initMultipartUploadToS3(key, { contentType, cacheControl, isPrivate })` |
| `uploadPartToS3(key, body, uploadId, partNumber, isPrivate)`   | `uploadPartToS3(key, body, { uploadId, partNumber, isPrivate })`         |
| `completeMultipartUploadToS3(key, uploadId, parts, isPrivate)` | `completeMultipartUploadToS3(key, { uploadId, parts, isPrivate })`       |
| `deleteFromS3(path, isPrivate)`, same for `listFromS3`         | `deleteFromS3(path, { isPrivate })`                                      |
| `copyFromS3(src, dest, isPrivate, deleteSrc)`                  | `copyFromS3(src, dest, { isPrivate, deleteSrc })`                        |

### Client

| v1                                                          | v2                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `uploadFiles(files, path, isPrivate, onProgress, maxAge)`   | `uploadFiles(files, { path, isPrivate, maxAge, onProgress })`   |
| `uploadInChunks(file, path, isPrivate, onProgress, maxAge)` | `uploadInChunks(file, { path, isPrivate, maxAge, onProgress })` |
| `deleteFiles(path, isPrivate)`                              | `deleteFiles(path, { isPrivate })`                              |
| `formatImage(file, maxHeight, format, quality)`             | `formatImage(file, { maxHeight, format, quality })`             |
| `appStore.notify(message, type, isSticky, params)`          | `appStore.notify(message, type, { isSticky, params })`          |

`isPrivate` is optional in `uploadFiles` and `uploadInChunks`, and defaults to `true`.

## Files are private by default

Every file function and route treats a file as private unless `isPrivate` is `false`. In v1, reading
(`getFile`, `GET /api/files/{path}`) and listing through the API (`GET /api/files`) defaulted to
public.

To read or list a public file through the API, pass the flag:

```ts
await getFile(event, path, { isPrivate: false })
await $fetch(`/api/files/${path}?isPrivate=false`)
```

The URLs the layer returns are unchanged: private files keep `?isPrivate=true`, public ones point to
`/files/…`, served by nginx or S3.

An upload is public only with `isPrivate=false`. In v1, the single-request upload also made a file
public for any other value than `true`.

## Other changes

- Changing a password writes a `security` log and emails the user the new `passwordChanged`
  template. `POST /api/auth` accepts a `locale` for it.
- The nightly `clean` task deletes expired refresh tokens.
- The admin logs search escapes `\`, which Postgres reads as the `LIKE` escape character.
- `/dev/email/{template}` is removed from production builds rather than checked at runtime.
