//
// For guidance on how to create filters see:
// https://prototype-kit.service.gov.uk/docs/filters
//

const govukPrototypeKit = require('govuk-prototype-kit')
const addFilter = govukPrototypeKit.views.addFilter

// Add your filters here

const MarkdownIt = require('markdown-it')
const sanitizeHtml = require('sanitize-html')

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

function markdownToGovukHtml (input) {
  const raw = String(input || '').trim()
  if (!raw) return ''

  const rendered = md.render(raw)

  return sanitizeHtml(rendered, {
    allowedTags: [
      'p',
      'br',
      'ul',
      'ol',
      'li',
      'a',
      'strong',
      'em',
      'code',
      'pre'
    ],
    allowedAttributes: {
      a: ['href', 'title']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      p: sanitizeHtml.simpleTransform('p', { class: 'govuk-body' }),
      ul: sanitizeHtml.simpleTransform('ul', { class: 'govuk-list govuk-list--bullet' }),
      ol: sanitizeHtml.simpleTransform('ol', { class: 'govuk-list govuk-list--number' }),
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          class: 'govuk-link',
          rel: 'noreferrer noopener'
        }
      }),
      pre: sanitizeHtml.simpleTransform('pre', { class: 'govuk-body' }),
      code: sanitizeHtml.simpleTransform('code', { class: 'govuk-body' })
    }
  })
}

addFilter('markdownToGovukHtml', markdownToGovukHtml)

