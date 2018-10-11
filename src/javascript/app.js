import { ajax, urlify, appResize, localStorage, storage, setting, parseNum } from './lib/helpers'
import I18n from './lib/i18n'
import client from './lib/client'

import renderAdmin from '../templates/admin.hdbs'
import renderDisplay from '../templates/display.hdbs'
import renderNoRequester from '../templates/no_requester.hdbs'
import errorMessage from '../templates/error.hdbs'
import renderSpoke from '../templates/spoke.hdbs'
import renderTags from '../templates/tags.hdbs'

import $ from 'jquery/src/core'
import 'jquery/src/core/parseHTML'
import 'jquery/src/manipulation'
import 'jquery/src/attributes'
import 'jquery/src/css/hiddenVisibleSelectors'
import 'jquery/src/effects'
import 'jquery/src/dimensions'
import 'jquery/src/css'
import 'jquery/src/data'

import { debounce, filter, map, find, reduce, includes, sortBy, each, compact, groupBy, fromPairs, isEmpty } from 'lodash'

const TICKET_STATUSES = ['new', 'open', 'solved', 'pending', 'hold', 'closed']
const MINUTES_TO_MILLISECONDS = 60000

const app = {
  init: function () {
    storage('ticketsCounters', {})
    storage('orgTicketsCounters', {})
    storage('user', null)
    storage('locales', null)
    storage('organizationFields', null)
    storage('userFields', null)
    storage('userEditable', true)

    app.getInformation().then(() => {
      app.fillEmptyStatuses(storage('ticketsCounters'))
      app.fillEmptyStatuses(storage('orgTicketsCounters'))
      app.showDisplay()
    }).catch((err) => {
      const view = (err.message === 'no requester') ? renderNoRequester() : errorMessage({ msg: err.message })
      $('[data-main]').html(view)
      appResize()
    })
  },

  getInformation: function () {
    return client.get(['ticket.requester', 'ticket.id', 'ticket.organization', 'currentUser']).then((data) => {
      const [ requester, ticketId, ticketOrg, currentUser ] = data
      const promises = []

      storage('currentUser', currentUser)
      storage('requester', requester)
      storage('ticketId', ticketId)
      storage('orgEditable.general', currentUser.role === 'admin')
      storage('orgEditable.notes', true)

      I18n.loadTranslations(currentUser.locale)

      if (requester) {
        promises.push(app.getUserInformation(ticketOrg))
      } else {
        return Promise.reject(new Error('no requester'))
      }

      // If not admin or agent
      if (['admin', 'agent'].indexOf(currentUser.role) === -1) {
        promises.push(app.getCustomRoles())
      }

      promises.push(app.getLocales())
      promises.push(ajax('getOrganizationFields').then(app.onGetOrganizationFieldsDone))
      promises.push(ajax('getUserFields').then(app.onGetUserFieldsDone))

      return Promise.all(promises)
    })
  },

  getUserInformation: function (ticketOrg) {
    const requester = storage('requester')

    return ajax('getUser', requester.id).then((data) => {
      const promises = []
      const user = data.user

      user.identities = data.identities.filter(function (ident) {
        return includes(['twitter', 'facebook'], ident.type)
      }).map(function (ident) {
        if (ident.type === 'twitter') {
          ident.value = `https://twitter.com/${ident.value}`
        } else if (ident.type === 'facebook') {
          ident.value = `https://facebook.com/${ident.value}`
        }
        return ident
      })

      user.organization = data.organizations[0]
      if (ticketOrg) {
        user.organization = find(data.organizations, function (org) {
          return org.id === ticketOrg.id
        })
      }
      promises.push(user)
      storage('user', user)

      if (data.user.organization_id) {
        promises.push(app.getTickets('organization', data.user.organization_id))
      }

      if (storage('ticketId')) {
        promises.push(app.getTicketAudits())
      }

      promises.push(app.getTickets('requester', user.id))

      return Promise.all(promises)
    })
  },

  getCustomRoles: function () {
    return ajax('getCustomRoles').then((data) => {
      const currentUser = storage('currentUser')
      const roles = data.custom_roles

      const role = find(roles, (role) => {
        return role.id === currentUser.role
      })

      storage('orgEditable.general', role.configuration.organization_editing)
      storage('orgEditable.notes', role.configuration.organization_notes_editing)
      storage('userEditable', role.configuration.end_user_profile_access === 'full')

      each(storage('organizationFields'), (field) => {
        if (field.key === '##builtin_tags') {
          // should we leave a comment here?
        } else if (field.key === '##builtin_notes') {
          field.editable = storage('orgEditable.notes')
        } else {
          field.editable = storage('orgEditable.general')
        }
      })
      return data
    })
  },

  getLocales: function () {
    return ajax('getLocales').then((data) => {
      const locales = fromPairs(map(data.locales, function (locale) {
        return [locale.locale, locale.name]
      }))

      storage('locales', locales)
      return locales
    })
  },

  getTicketAudits: function () {
    return ajax('getTicketAudits', storage('ticketId')).then((data) => {
      each(data.audits, (audit) => {
        each(audit.events, (e) => {
          if (app.auditEventIsSpoke(e)) {
            const spokeData = app.spokeData(e)

            if (spokeData) {
              storage('spokeData', spokeData)
              const user = storage('user')
              user.email = spokeData.email
              storage('user', user)
              app.displaySpoke()
            }
          }
        })
      })
      return data.audits
    })
  },

  getTickets: function (type, id) {
    const TYPES = {
      requester: { ajax: 'getTickets', storage: 'ticketsCounters' },
      organization: { ajax: 'getOrganizationTickets', storage: 'orgTicketsCounters' }
    }

    if (!TYPES[type]) throw new Error('no such type defined.')

    // First use search to decide what to do
    return ajax('searchTickets', `${type}:${id}`).then((data) => {
      if (data.count === 1) {
        // If only 1 result, we already have that result, and trick processTicketData
        // into thinking we got the data from tickets response
        data.tickets = data.results
        return data
      } else if (data.count <= 100) {
        // If we only needed 1 requests
        return ajax(TYPES[type].ajax, id)
      } else {
        // If we need more requests
        return app.getTicketsThroughSearch(`${type}:${id}`)
      }
    }).then((data) => {
      const res = app.processTicketData(data)
      storage(TYPES[type].storage, res)
      return res
    })
  },

  getTicketsThroughSearch: function (searchTerm) {
    const promises = TICKET_STATUSES.map((status) => {
      return ajax('searchTickets', `${searchTerm} status:${status}`)
    })
    return Promise.all(promises)
  },

  processTicketData: function (data) {
    let res

    // If data.tickets it means it's a tickets repsonse
    if (data.tickets) {
      const grouped = groupBy(data.tickets, 'status')
      res = fromPairs(map(grouped, (value, key) => {
        return [key, parseNum(value.length)]
      }))

    // Else it's a search response
    } else {
      res = TICKET_STATUSES.reduce((memo, status, i) => {
        memo[status] = parseNum(data[i].count)
        return memo
      }, {})
    }

    return res
  },

  formatFields: function (target, fields, selected, values, locales) {
    return compact(map(selected, function (key) {
      const field = find(fields, function (field) {
        return field.key === key
      })

      if (!field) { return null }

      const result = {
        key: key,
        description: field.description,
        title: field.title,
        editable: field.editable
      }

      if (key.indexOf('##builtin') === 0) {
        const subkey = key.split('_')[1]
        result.name = subkey
        result.value = target[subkey]
        result.simpleKey = ['builtin', subkey].join(' ')

        if (app.couldHideField(result)) { return null }

        if (subkey === 'tags') {
          result.value = renderTags({tags: result.value})
          result.html = true
        } else if (subkey === 'locale') {
          result.value = locales[result.value]
        } else if (!result.editable && typeof result.value === 'string') {
          result.value = result.value.replace(/\n/g, '<br>')
          result.html = true
        }
      } else {
        result.simpleKey = ['custom', key].join(' ')
        result.value = values[key]

        if (app.couldHideField(result)) { return null }

        if (typeof result.value === 'string' && result.value.indexOf('http') > -1) {
          result.html = true
          result.value = urlify(result.value)
        }

        if (field.type === 'date') {
          result.value = (result.value ? app.toLocaleDate(result.value) : '')
        } else if (field.type === 'dropdown' && field.custom_field_options) {
          const option = find(field.custom_field_options, function (option) {
            return option.value === result.value
          })
          result.value = (option) ? option.name : ''
        } else if (!result.editable && typeof result.value === 'string') {
          result.value = result.value.replace(/\n/g, '<br>')
          result.html = true
        }
      }
      return result
    }))
  },

  fieldsForCurrentUser: function () {
    if (!storage('user')) { return {} }
    return app.formatFields(
      storage('user'),
      storage('userFields'),
      setting('selectedFields') ? JSON.parse(setting('selectedFields')) : ['##builtin_tags', '##builtin_details', '##builtin_notes'],
      storage('user').user_fields,
      storage('locales')
    )
  },

  fieldsForCurrentOrg: function () {
    if (!storage('user') || !storage('user').organization) { return {} }
    return app.formatFields(
      storage('user').organization,
      storage('organizationFields'),
      setting('orgFields') ? JSON.parse(setting('orgFields')) : [],
      storage('user').organization.organization_fields,
      storage('locales')
    )
  },

  fillEmptyStatuses: function (list) {
    return reduce(TICKET_STATUSES, function (list, key) {
      if (!list[key]) {
        list[key] = '-'
      }
      return list
    }, list)
  },

  couldHideField: function (field) {
    return setting('hideEmptyFields') && !field.value && !field.editable
  },

  toLocaleDate: function (date) {
    const currentUser = storage('currentUser')
    const userTimeZoneOffset = currentUser.timeZone.offset * MINUTES_TO_MILLISECONDS // offset in milliseconds
    const utcTimestamp = new Date(date).getTime()
    const localDate = new Date(utcTimestamp + userTimeZoneOffset)

    return localDate.toLocaleDateString(currentUser.locale)
  },

  showDisplay: function () {
    const currentUser = storage('currentUser')
    const view = renderDisplay({
      ticketId: storage('ticketId'),
      isAdmin: currentUser.role === 'admin',
      user: storage('user'),
      tickets: app.makeTicketsLinks(storage('ticketsCounters')),
      fields: app.fieldsForCurrentUser(),
      orgFields: app.fieldsForCurrentOrg(),
      orgFieldsActivated: storage('user') && setting('orgFieldsActivated') && storage('user').organization,
      org: storage('user') && storage('user').organization,
      orgTickets: app.makeTicketsLinks(storage('orgTicketsCounters'))
    })

    $('[data-main]').html(view)
    appResize()

    if (storage('spokeData')) {
      app.displaySpoke()
    }
    if (localStorage('expanded')) {
      app.onClickExpandBar({}, true)
    }
  },

  makeTicketsLinks: function (counters) {
    const links = {}
    const $tag = $('<div>').append($('<a>').attr('href', 'javascript:void(0)'))
    each(counters, function (value, key) {
      if (value && value !== '-') {
        $tag.find('a').html(value)
        links[key] = $tag.html()
      } else {
        links[key] = value
      }
    })
    appResize()
    return links
  },

  onRequesterEmailChanged: function (email) {
    const requester = storage('requester') || {}

    if (email && requester.email !== email) {
      app.init()
    }
  },

  onClickExpandBar: function (event, immediate) {
    const additional = $('.more-info')
    const expandBar = $('.expand_bar i')
    expandBar.attr('class', 'arrow')
    const visible = additional.is(':visible')
    additional.toggle(!visible, appResize)
    localStorage('expanded', !visible)
    expandBar.addClass(visible ? 'arrow_down' : 'arrow_up')
    appResize()
  },

  onCogClick: function () {
    const html = renderAdmin({
      fields: storage('userFields'),
      orgFields: storage('organizationFields'),
      orgFieldsActivated: setting('orgFieldsActivated'),
      hideEmptyFields: setting('hideEmptyFields')
    })
    $('.admin').html(html).show()
    $('.whole').hide()
    appResize()
  },

  onBackClick: function () {
    $('.admin').hide()
    $('.whole').show()
    appResize()
  },

  onSaveClick: function () {
    const keys = $('.fields-list input:checked').map(function () { return $(this).val() })
    const orgKeys = $('.org_fields_list input:checked').map(function () { return $(this).val() })
    const hideEmptyFields = $('input.hide_empty_fields').is(':checked')
    setting('hideEmptyFields', hideEmptyFields)

    $('input, button').prop('disabled', true)
    $('.save .text').hide()
    $('.save .spinner').show()

    ajax('saveSelectedFields', keys, orgKeys).then(app.init)
  },

  onNotesOrDetailsChanged: debounce(function (e) {
    const $textarea = $(e.currentTarget)
    const $textareas = $textarea.parent().parent().find('[data-editable =true] textarea')
    const type = $textarea.data('fieldType')
    const typeSingular = type.slice(0, -1)
    const data = {}
    const requester = storage('requester')
    const id = type === 'organizations' ? storage('user').organization.id : requester.id

    // Build the data object, with the valid resource name and data
    data[typeSingular] = {}
    $textareas.each(function (index, element) {
      const $element = $(element)
      const fieldName = $element.data('fieldName')

      data[typeSingular][fieldName] = $element.val()
    })

    // Execute request
    ajax('updateNotesOrDetails', type, id, data).then(function () {
      client.invoke('notify', (I18n.t('update_' + typeSingular + '_done')))
    })
  }, 1500),

  onActivateOrgFieldsChange: function (event) {
    const activate = $(event.target).is(':checked')
    setting('orgFieldsActivated', activate)
    $('.org_fields_list').toggle(activate)
    appResize()
  },

  displaySpoke: function () {
    const html = renderSpoke(storage('spokeData'))
    $('.spoke').html(html)
    appResize()
  },

  auditEventIsSpoke: function (event) {
    return event.type === 'Comment' && /spoke_id_/.test(event.body)
  },

  spokeData: function (event) {
    const data = /spoke_id_(.*) *\n *spoke_account_(.*) *\n *requester_email_(.*) *\n *requester_phone_(.*)/.exec(event.body)

    if (isEmpty(data)) {
      return false
    }

    return {
      id: data[1].trim(),
      account: data[2].trim(),
      email: data[3].trim(),
      phone: data[4].trim()
    }
  },

  onGetOrganizationFieldsDone: function (data) {
    const fields = [
      {
        key: '##builtin_tags',
        title: I18n.t('tags'),
        description: '',
        position: 0,
        active: true
      },
      {
        key: '##builtin_details',
        title: I18n.t('details'),
        description: '',
        position: Number.MAX_SAFE_INTEGER - 1,
        active: true,
        editable: storage('orgEditable.general')
      },
      {
        key: '##builtin_notes',
        title: I18n.t('notes'),
        description: '',
        position: Number.MAX_SAFE_INTEGER,
        active: true,
        editable: storage('orgEditable.notes')
      }
    ].concat(data.organization_fields)

    const activeFields = filter(fields, function (field) {
      return field.active
    })

    const restrictedFields = map(activeFields, (field) => {
      return {
        key: field.key,
        title: field.title,
        description: field.description,
        custom_field_options: field.custom_field_options,
        position: field.position,
        selected: includes(setting('orgFields') ? JSON.parse(setting('orgFields')) : [], field.key),
        editable: field.editable,
        type: field.type
      }
    })

    storage('organizationFields', sortBy(restrictedFields, 'position'))
    return restrictedFields
  },

  onGetUserFieldsDone: function (data) {
    const fields = [
      {
        key: '##builtin_tags',
        title: I18n.t('tags'),
        description: '',
        position: 0,
        active: true
      },
      {
        key: '##builtin_locale',
        title: I18n.t('locale'),
        description: '',
        position: 1,
        active: true
      },
      {
        key: '##builtin_details',
        title: I18n.t('details'),
        description: '',
        position: Number.MAX_SAFE_INTEGER - 1,
        active: true,
        editable: storage('userEditable')
      },
      {
        key: '##builtin_notes',
        title: I18n.t('notes'),
        description: '',
        position: Number.MAX_SAFE_INTEGER,
        active: true,
        editable: storage('userEditable')
      }
    ].concat(data.user_fields)

    const activeFields = filter(fields, function (field) {
      return field.active
    })

    const restrictedFields = map(activeFields, (field) => {
      return {
        key: field.key,
        title: field.title,
        description: field.description,
        position: field.position,
        selected: includes(setting('selectedFields')
          ? JSON.parse(setting('selectedFields'))
          : ['##builtin_tags', '##builtin_details', '##builtin_notes'], field.key),
        editable: field.editable,
        type: field.type,
        custom_field_options: field.custom_field_options
      }
    })

    storage('userFields', sortBy(restrictedFields, 'position'))
    return restrictedFields
  },

  goToTab: function (tabType) {
    if (app.isPersistedTicket()) {
      app.openTicketTab(tabType)
    } else {
      // Open redirection tab for new tickets
      app.openUserTab(tabType)
    }
  },

  isPersistedTicket: function () {
    return !!storage('ticketId')
  },

  // HACK for navigating to a url, since routeTo doesn't support this.
  // https://developer.zendesk.com/apps/docs/support-api/all_locations#routeto
  openTicketTab (ticketTab) {
    const path = ticketTab === 'organization' ? 'tickets' : 'requested_tickets'
    return client.invoke('routeTo', 'nav_bar', '', `../../tickets/${storage('ticketId')}/${ticketTab}/${path}`)
  },

  openUserTab (tabType) {
    const path = tabType === 'organization' ? 'organization/tickets' : 'assigned_tickets'
    return client.invoke('routeTo', 'nav_bar', '', `../../users/${storage('requester').id}/${path}`)
  }
}

$(document).on('click', 'a.expand_bar', app.onClickExpandBar)
$(document).on('click', '.cog', app.onCogClick)
$(document).on('change keyup input paste', '.notes-or-details', app.onNotesOrDetailsChanged)
$(document).on('change', '.org_fields_activate', app.onActivateOrgFieldsChange)
$(document).on('click', '.back', app.onBackClick)
$(document).on('click', '.save', app.onSaveClick)
$(document).on('mouseup', 'textarea', debounce(appResize, 300))
$(document).on('click', '.card.user .counts a, .card.user .contacts .name a', () => app.goToTab('requester'))
$(document).on('click', '.card.org .counts a, .card.user .contacts .organization a, .card.org .contacts .name a', () => app.goToTab('organization'))

export default app
