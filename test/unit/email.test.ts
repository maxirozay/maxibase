import { describe, it, expect, beforeEach } from 'vitest'
import { resetTestState, storage } from '../setup'
import { buildEmail, buildEmailTemplate, escapeHtml, fillTemplate } from '#server-utils/email'

beforeEach(resetTestState)

function seedTemplate(html: string, locale = 'en', id = 'test') {
  storage.set(`assets:server:emails/${locale}/${id}.html`, html)
}

function seedBase(base: string, localeBase?: string) {
  storage.set('assets:server:emails/base.html', base)
  if (localeBase !== undefined) storage.set('assets:server:emails/en/base.html', localeBase)
}

describe('escapeHtml', () => {
  it('neutralises the characters that carry markup', () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;',
    )
  })
})

describe('fillTemplate', () => {
  it('fills placeholders from the params', () => {
    expect(fillTemplate('<p>{{otp}}</p>', { otp: '123456' })).toBe('<p>123456</p>')
  })

  // The app values come from the config, not from the caller, but templates
  // address them with the same syntax as any other placeholder.
  it('resolves the app placeholders without being passed them', () => {
    expect(fillTemplate('{{appName}} at {{url}}')).toBe('Test app at https://app.test')
  })

  it('lets a param override an app placeholder', () => {
    expect(fillTemplate('{{appName}}', { appName: 'White label' })).toBe('White label')
  })

  // Params carry user-controlled values (an email address, a name), and they land
  // in HTML that we send on the user's behalf.
  it('escapes params in the body', () => {
    const html = fillTemplate('<p>{{email}}</p>', { email: '<script>alert(1)</script>@x.test' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps a magic link usable once escaped', () => {
    const html = fillTemplate('<a href="{{magicLink}}">go</a>', {
      magicLink: 'https://app.test/signin?email=a%40b.test&token=abc',
    })
    // &amp; in an href is the correct spelling of a literal &.
    expect(html).toContain('href="https://app.test/signin?email=a%40b.test&amp;token=abc"')
  })

  it('leaves the value unescaped when escaping is off, for subject lines', () => {
    expect(fillTemplate('{{name}} & co', { name: 'A&B' }, false)).toBe('A&B & co')
  })

  // A template that needs real markup in a param asks for it explicitly, so the
  // escaped form stays the default everywhere else.
  it('inserts a triple-braced param as raw html', () => {
    expect(fillTemplate('<p>{{{body}}}</p>', { body: '<strong>hi</strong>' })).toBe(
      '<p><strong>hi</strong></p>',
    )
  })

  it('still escapes the double-braced params alongside a raw one', () => {
    const html = fillTemplate('{{{body}}}{{name}}', { body: '<b>x</b>', name: '<b>y</b>' })
    expect(html).toBe('<b>x</b>&lt;b&gt;y&lt;/b&gt;')
  })

  it('renders a missing raw param as empty', () => {
    expect(fillTemplate('[{{{missing}}}]', {})).toBe('[]')
  })

  it('renders a missing param as empty, not as the placeholder', () => {
    expect(fillTemplate('[{{missing}}]', {})).toBe('[]')
  })

  // One pass over the document: a value that happens to contain braces is
  // inserted as-is, never expanded as a placeholder of its own.
  it('does not re-scan a substituted value', () => {
    expect(fillTemplate('<p>{{name}}</p>', { name: '{{url}}' })).toBe('<p>{{url}}</p>')
  })
})

describe('buildEmail', () => {
  it('wraps the content in the base and the locale base', async () => {
    seedBase('<body><h1>{{appName}}</h1>{{content}}</body>', '<section>{{content}}</section>')
    const html = await buildEmail('<p>{{otp}}</p>', 'en', { otp: '123456' })
    expect(html).toBe('<body><h1>Test app</h1><section><p>123456</p></section></body>')
  })

  it('falls back to the root base when the locale has none', async () => {
    seedBase('<body>{{content}}</body>')
    expect(await buildEmail('<p>hi</p>', 'en')).toBe('<body><p>hi</p></body>')
  })

  // The stylesheet lives in the root base, so a class used by a template only
  // resolves once the document is assembled.
  it('inlines the base stylesheet onto the content classes', async () => {
    seedBase('<body>{{content}}<style>.button { color: red; }</style></body>', '{{content}}')
    const html = await buildEmail('<a class="button" href="{{url}}">go</a>', 'en')
    expect(html).toContain('<a style="color: red;" href="https://app.test">go</a>')
  })
})

describe('buildEmailTemplate', () => {
  it('returns the raw template and its title as the subject', async () => {
    seedTemplate('<title>Your code</title><p>{{otp}}</p>')
    const { subject, html } = await buildEmailTemplate('test', 'en')
    expect(subject).toBe('Your code')
    expect(html).toContain('<p>{{otp}}</p>')
  })

  it('falls back to the app name when the template has no title', async () => {
    seedTemplate('<p>x</p>')
    const { subject } = await buildEmailTemplate('test', 'en')
    expect(fillTemplate(subject, {}, false)).toBe('Test app')
  })

  it('falls back to the english template for an unknown locale', async () => {
    seedTemplate('<title>english</title><p>en</p>')
    const { subject } = await buildEmailTemplate('test', 'de')
    expect(subject).toBe('english')
  })

  it('falls back to the layer template when the project has none', async () => {
    storage.set('assets:base:emails/en/test.html', '<title>layer</title>')
    const { subject } = await buildEmailTemplate('test', 'en')
    expect(subject).toBe('layer')
  })

  it('prefers the project template over the layer one', async () => {
    storage.set('assets:base:emails/en/test.html', '<title>layer</title>')
    seedTemplate('<title>project</title>')
    const { subject } = await buildEmailTemplate('test', 'en')
    expect(subject).toBe('project')
  })

  it('throws when no template exists at all', async () => {
    await expect(buildEmailTemplate('nope', 'en')).rejects.toThrow(/Email template not found/)
  })
})
