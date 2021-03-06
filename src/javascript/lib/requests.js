import { setting, storage } from './helpers'
import { toArray } from 'lodash'

export default {
  getLocales: {
    url: '/api/v2/locales.json'
  },

  getOrganizationFields: {
    url: '/api/v2/organization_fields.json'
  },

  getCustomRoles: {
    url: '/api/v2/custom_roles.json'
  },

  getUserFields: {
    url: '/api/v2/user_fields.json'
  },

  getOrganizationTickets: function (orgId, page = 1) {
    return {
      url: `/api/v2/organizations/${orgId}/tickets.json?page=${page}`
    }
  },

  getTicketAudits: function (id) {
    return {
      url: `/api/v2/tickets/${id}/audits.json`
    }
  },

  getTickets: function (userId, page = 1) {
    return {
      url: `/api/v2/users/${userId}/tickets/requested.json?page=${page}`
    }
  },

  searchTickets: function (searchTerm = '') {
    return {
      url: `/api/v2/search.json?query=type:ticket ${searchTerm}&per_page=1`
    }
  },

  getUser: function (userId) {
    return {
      url: `/api/v2/users/${userId}.json?include=identities,organizations`,
      cachable: true
    }
  },

  saveSelectedFields: function (keys, orgKeys) {
    const installationId = storage('installationId')

    setting('selectedFields', JSON.stringify(toArray(keys)))
    setting('orgFields', JSON.stringify(toArray(orgKeys)))

    const settingsRequest = {
      url: `/api/v2/apps/installations/${installationId}.json`,
      type: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({
        settings: {
          selectedFields: setting('selectedFields'),
          orgFields: setting('orgFields'),
          orgFieldsActivated: setting('orgFieldsActivated') ? 'true' : 'false',
          hideEmptyFields: setting('hideEmptyFields') ? 'true' : 'false'
        },
        enabled: true
      })
    }

    // For dev
    if (installationId < 1) {
      console.log('would have sent', settingsRequest)
      return {}
    }

    return settingsRequest
  },

  updateNotesOrDetails: function (type, id, data) {
    return {
      url: `/api/v2/${type}/${id}.json`,
      type: 'PUT',
      data: data
    }
  }
}
