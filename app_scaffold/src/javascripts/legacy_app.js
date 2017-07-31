import BaseApp from 'base_app'; // ZAF v1 shims

var App = {
  TICKET_STATUSES: ['new', 'open', 'solved', 'pending', 'hold', 'closed'],

  events: {
    // App
    'app.created': 'init',
    'ticket.requester.email.changed': 'onRequesterEmailChanged',

    // Requests
    'getLocales.done': 'onGetLocalesDone',
    'getUserFields.done': 'onGetUserFieldsDone',
    'getOrganizationFields.done': 'onGetOrganizationFieldsDone',

    // UI
    'click .expand-bar': 'onClickExpandBar',
    'click .cog': 'onCogClick',
    'click .back': 'onBackClick',
    'click .save': 'onSaveClick',
    'change .org-fields-activate': 'onActivateOrgFieldsChange',
    'change,keyup,input,paste .notes-or-details': 'onNotesOrDetailsChanged',

    // Misc
    'requestsFinished': 'onRequestsFinished'
  },

  requests: {
  
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

    getOrganizationTickets: function(orgId) {
      return {
        url: `/api/v2/organizations/${orgId}/tickets.json`
      };
    },

    getTicketAudits: function(id){
      return {
        url: `/api/v2/tickets/${id}/audits.json`
      };
    },

    getTickets: function(userId, page) {
      page = page || 1;
      return {
        url: `/api/v2/users/${userId}/tickets/requested.json?page=${page}`
      };
    },

    searchTickets: function(userId, status) {
      return {
        url: `/api/v2/search.json?query=type:ticket requester:${userId} status:${status}`
      };
    },

    getUser: function(userId) {
      return {
        url: `/api/v2/users/${userId}.json?include=identities,organizations`
      };
    },

    saveSelectedFields: function(keys, orgKeys) {
      var installationId = this.installationId();
      var settings = {
        selectedFields: JSON.stringify(_.toArray(keys)),
        orgFieldsActivated: this.globalStorage.orgFieldsActivated.toString(),
        orgFields: JSON.stringify(_.toArray(orgKeys))
      };

      this.settings = _.extend(this.settings, settings);

      return {
        url: `/api/v2/apps/installations/${installationId}.json`,
        type: 'PUT',
        data: {
          'settings': settings,
          'enabled': true
        }
      };
    },

    updateNotesOrDetails: function(type, id, data) {
      return {
        url: `/api/v2/${type}/${id}.json`,
        type: 'PUT',
        data: data
      };
    }
  },

  globalStorage: {
    promise: null,
    locales: null,
    organizationFields: null,
    userFields: null,
    orgEditable: null,
    userEditable: true,
    selectedKeys: null,
    selectedOrgKeys: null,
    orgFieldsActivated: false
  },

  // TOOLS ===================================================================

  fieldsForCurrent: function(target, fields, selected, values) {
    return _.compact(_.map(selected, (function(key) {
      var field = _.find(fields, function(field) {
        return field.key === key;
      });

      if (!field) {
        return null;
      }

      var result = {
        key: key,
        description: field.description,
        title: field.title,
        editable: field.editable
      };

      if (key.indexOf('##builtin') === 0) {
        var subkey = key.split('_')[1];
        result.name = subkey;
        result.value = target[subkey];
        result.simpleKey = ['builtin', subkey].join(' ');

        if (subkey === 'tags') {
          result.value = this.renderTemplate('tags', {tags: result.value});
          result.html = true;

        } else if (subkey === 'locale') {
          result.value = this.globalStorage.locales[result.value];

        } else if (!result.editable) {
          result.value = _.escape(result.value).replace(/\n/g,'<br>');
          result.html = true;
        }

      } else {
        result.simpleKey = ['custom', key].join(' ');
        result.value = values[key];

        if (result.value.indexOf('http') > -1 ){
          result.link = true;
        }
        
        if (field.type === 'date') {
          result.value = (result.value ? this.toLocaleDate(result.value) : '');

        } else if(!result.editable && values[key]) {
          result.value = _.escape(values[key]).replace(/\n/g,'<br>');
          result.html = true;
        }
      }
      return result;
    }).bind(this)));
  },

  fieldsForCurrentOrg: function() {
    if (!this.storage.user || !this.storage.user.organization) {
      return {};
    }
    return this.fieldsForCurrent(this.storage.user.organization,
                                  this.globalStorage.organizationFields,
                                  this.globalStorage.selectedOrgKeys,
                                  this.storage.user.organization.organization_fields);
  },

  fillEmptyStatuses: function(list) {
    return _.reduce(this.TICKET_STATUSES, function(list, key) {
      if (!list[key]) {
        list[key] = '-';
      }
      return list;
    }, list);
  },

  fieldsForCurrentUser: function() {
    if (!this.storage.user) {
      return {};
    }
    return this.fieldsForCurrent(this.storage.user,
                                  this.globalStorage.userFields,
                                  this.globalStorage.selectedKeys,
                                  this.storage.user.user_fields);
  },

  toLocaleDate: function(date) {
    return moment(date).utc().format('l');
  },

  showDisplay: function() {
    this.getTicket().then((ticket) => {
      this.getCurrenUser().then((currentUser) => {
        this.switchTo('display', {
          ticketId: ticket.id,
          isAdmin: currentUser.role === 'admin',
          user: this.storage.user,
          tickets: this.makeTicketsLinks(this.storage.ticketsCounters),
          fields: this.fieldsForCurrentUser(),
          orgFields: this.fieldsForCurrentOrg(),
          orgFieldsActivated: this.storage.user && this.globalStorage.orgFieldsActivated && this.storage.user.organization,
          org: this.storage.user && this.storage.user.organization,
          orgTickets: this.makeTicketsLinks(this.storage.orgTicketsCounters)
        });
        if (this.storage.spokeData) {
          this.displaySpoke();
        }
        if (this.store('expanded')) {
          this.onClickExpandBar(true);
        }
      });
    });
  },

  makeTicketsLinks: function(counters) {
    return this.getTicket().then((ticket) => {
      var links = {};
      var link = `#/tickets/${ticket.id}/requester/requested_tickets`;
      var tag = this.$('<div>').append(this.$('<a>').attr('href', link));
      _.each(counters, function(value, key) {
        if (value && value !== '-') {
          tag.find('a').html(value);
          links[key] = tag.html();
        }
        else {
          links[key] = value;
        }
      }.bind(this));
      return links;
    })
  },

  setGlobalStorage: function() {
    if (this.globalStorage.promise) return this.globalStorage.promise;

    this.globalStorage.promise = this.getCurrenUser().then((currentUser) => {
      var promises = [];
      var role = currentUser.role;

      this.globalStorage.orgEditable = {
        general: role === "admin",
        notes: true
      };

      if (role !== "admin" && role !== "agent") {
        promises.push( this.ajax('getCustomRoles').then(this.onGetCustomRolesDone.bind(this)) );
      }

      promises.push ( this.ajax('getLocales') );
      promises.push ( this.ajax('getOrganizationFields') );
      promises.push ( this.ajax('getUserFields') );

      return this.when.apply(this, promises);
    });

    return this.globalStorage.promise;
  },

  // HELPERS =================================================================
  getCurrenUser: function(){
    return this.zafClient.get('currentUser').then((data) => {
      return data.currentUser;
    });
  },

  getTicket: function(){
    return this.zafClient.get('ticket').then((data) => {
      return data.ticket;
    });
  },

  // EVENTS ==================================================================

  init: function() {
    var selectedFields = this.setting('selectedFields');
    var orgFields = this.setting('orgFields');

    _.extend(this.globalStorage, {
      selectedKeys: selectedFields ? JSON.parse(selectedFields) : ["##builtin_tags", "##builtin_details", "##builtin_notes"],
      selectedOrgKeys: orgFields ? JSON.parse(orgFields) : [],
      orgFieldsActivated: this.setting('orgFieldsActivated') === 'true'
    });

    this.storage = {
      user: null,
      ticketsCounters: {},
      orgTicketsCounters: {},
      tickets: []
    };

    var globalPromise = this.setGlobalStorage();

    this.getTicket().then((ticket) => {
      if (ticket.requester) {
        
        var localPromise = new Promise((resolve) => {
          this.ajax('getUser', ticket.requester.id).then((userData) => {
            console.log("getUser start");
            this.onGetUserDone(userData).then(() => {
              //resolve();
              console.log("getUser done");
            });
          });
        })

        debugger; 
        this.when(globalPromise, localPromise).then(() => {
          console.log('requestsFinished', globalPromise, localPromise)
          this.zafClient.trigger('requestsFinished');
        });

      } else {
        this.switchTo('empty');
      }
    });
  },

  onRequesterEmailChanged: function(event, email) {
    this.getTicket().then((ticket) => {
      if (email && ticket.requester.email != email) {
        this.init();
      }
    })
  },

  onRequestsFinished: function() {
    if (!this.storage.user) return;

//    var ticketsCounters = this.fillEmptyStatuses(this.storage.ticketsCounters);
//    var orgTicketsCounters = this.fillEmptyStatuses(this.storage.orgTicketsCounters);

    this.showDisplay();
  },

  onClickExpandBar: function(event, immediate) {
    var additional = this.$('.more-info');
    var expandBar = this.$('.expand-bar i');
    expandBar.attr('class', 'arrow');
    var visible = additional.is(':visible');
    if (immediate) {
      additional.toggle(!visible);
    }
    else {
      additional.slideToggle(!visible);
      this.store('expanded', !visible);
    }
    expandBar.addClass(visible ? 'arrow-down' : 'arrow-up');
  },

  onCogClick: function() {
    var html = this.renderTemplate('admin', {
      fields: this.globalStorage.userFields,
      orgFields: this.globalStorage.organizationFields,
      orgFieldsActivated: this.globalStorage.orgFieldsActivated
    });
    this.$('.admin').html(html).show();
    this.$('.whole').hide();
  },

  onBackClick: function() {
    this.$('.admin').hide();
    this.$('.whole').show();
  },

  onSaveClick: function() {
    var that = this;
    var keys = this.$('.fields-list input:checked').map(function() { return that.$(this).val(); });
    var orgKeys = this.$('.org-fields-list input:checked').map(function() { return that.$(this).val(); });
    this.$('input, button').prop('disabled', true);
    this.$('.save').hide();
    this.$('.wait-spin').show();

    this.globalStorage.promise = null; // we need to reset the promise object to have getUserFields run again
    this.ajax('saveSelectedFields', keys, orgKeys)
      .always(this.init.bind(this));
  },

  onNotesOrDetailsChanged: _.debounce(function(e) {
    var $textarea    = this.$(e.currentTarget),
        $textareas   = $textarea.parent().siblings('[data-editable=true]').andSelf().find('textarea'),
        type         = $textarea.data('fieldType'),
        typeSingular = type.slice(0, -1),
        data         = {},
        id           = type === 'organizations' ? this.storage.organization.id : this.ticket().requester().id();

    // Build the data object, with the valid resource name and data
    data[typeSingular] = {};
    $textareas.each(function(index, element) {
      var $element  = this.$(element),
          fieldName = $element.data('fieldName');

      data[typeSingular][fieldName] = $element.val();
    }.bind(this));

    // Execute request
    this.ajax('updateNotesOrDetails', type, id, data).then(function() {
      this.zafClient.invoke('notify', this.I18n.t('update_' + typeSingular + '_done'));
    }.bind(this));
  }, 1500),

  onActivateOrgFieldsChange: function(event) {
    var activate = this.$(event.target).is(':checked');
    this.globalStorage.orgFieldsActivated = activate;
    this.$('.org-fields-list').toggle(activate);
  },

  // REQUESTS ================================================================

  onGetCustomRolesDone: function(data) {
    var roles = data.custom_roles;

    var role = _.find(roles, function(role) {
      return role.id === this.currentUser().role();
    }, this);

    this.globalStorage.orgEditable.general = role.configuration.organization_editing;
    this.globalStorage.orgEditable.notes = role.configuration.organization_notes_editing;
    this.globalStorage.userEditable = role.configuration.end_user_profile_access === "full";

    _.each(this.globalStorage.organizationFields, function(field) {
      if (field.key === '##builtin_tags') {
        return;

      } else if (field.key === '##builtin_notes') {
        field.editable = this.globalStorage.orgEditable.notes;

      } else {
        field.editable = this.globalStorage.orgEditable.general;
      }
    }, this);
  },

  onGetLocalesDone: function(data) {
    this.globalStorage.locales = _.reduce(data.locales, function(locales, obj) {
      locales[obj.locale] = obj.name;
      return locales;
    }, {});
  },

  onGetUserDone: function(data) {
    this.storage.user = data.user;
    var social = _.filter(data.identities, function(ident) {
      return _.contains(['twitter', 'facebook'], ident.type);
    });
    this.storage.user.identities = _.map(social, function(ident) {
      if (ident.type === 'twitter') {
        ident.value = `https://twitter.com/${ident.value}`;
      } else if (ident.type === 'facebook') {
        ident.value = `https://facebook.com/${ident.value}`;
      }
      return ident;
    });
    this.storage.user.organization = data.organizations[0];

    return this.getTicket().then((ticket) => {
      var ticketOrg = ticket.organization;
      if (ticketOrg) {
        this.storage.user.organization = _.find(data.organizations, function(org) {
          return org.id === ticketOrg.id;
        });
      }

      var promises = [];
      if (data.user && data.user.id) {
        promises.push( this.ajax('getTickets', this.storage.user.id).then(this.onGetTicketsDone.bind(this)) );
      }
      if (data.user.organization) {
        this.storage.organization = {
          id: data.user.organization.id
        };
        promises.push( this.ajax('getOrganizationTickets', this.storage.organization.id).then(this.onGetOrganizationTicketsDone.bind(this)) );
      }

      if (ticket.id) {
        promises.push( this.ajax('getTicketAudits', ticket.id).then(this.onGetTicketAuditsDone.bind(this)) );
      }

      return this.when.apply(this, promises);
    });
  },

  onGetTicketAuditsDone: function(data) {
    _.each(data.audits, function(audit){
      _.each(audit.events, function(e){
        if (this.auditEventIsSpoke(e)){
          var spokeData = this.spokeData(e);

          if (spokeData){
            this.storage.spokeData = spokeData;
            this.storage.user.email = spokeData.email;
            this.displaySpoke();
          }
        }
      }, this);
    }, this);
    console.log('onGetTicketAuditsDone set');
  },

  displaySpoke: function() {
    var html = this.renderTemplate('spoke', this.storage.spokeData);
    this.$('.spoke').html(html);
  },

  auditEventIsSpoke: function(event){
    return event.type === 'Comment' &&
      /spoke_id_/.test(event.body);
  },

  spokeData: function(event){
    var data = /spoke_id_(.*) *\n *spoke_account_(.*) *\n *requester_email_(.*) *\n *requester_phone_(.*)/.exec(event.body);

    if (_.isEmpty(data))
      return false;

    return {
      id: data[1].trim(),
      account: data[2].trim(),
      email: data[3].trim(),
      phone: data[4].trim()
    };
  },

  onSearchTicketsDone: function(data) {
    var status = this.TICKET_STATUSES[this.ticketSearchStatus];
    this.storage.ticketsCounters = this.storage.ticketsCounters || {};
    console.log('ticketsCounters set');
    this.storage.ticketsCounters[status] = data.count;
    if (this.ticketSearchStatus === this.TICKET_STATUSES.length - 1) {
      return;
    }

    return this.ajax('searchTickets', this.storage.user.id, this.TICKET_STATUSES[++this.ticketSearchStatus]).then(this.onSearchTicketsDone.bind(this));
  },

  onGetTicketsDone: function(data) {
    this.storage.tickets.push.apply(this.storage.tickets, data.tickets);
    if (data.next_page) {
      // determine if it is fewer API hits to search by ticket status type, or to continue loading remaining pages
      if (data.count / data.tickets.length - 1 > this.TICKET_STATUSES.length) {
        this.ticketSearchStatus = 0;
        return this.ajax('searchTickets', this.storage.user.id, this.TICKET_STATUSES[this.ticketSearchStatus]).then(this.onSearchTicketsDone.bind(this));
      }
      var pageNumber = data.next_page.match(/page=(\d+)/)[1];
      return this.ajax('getTickets', this.storage.user.id, pageNumber).then(this.onGetTicketsDone.bind(this));
      console.log('onGetTicketsDone loop');
    } else {
      var grouped = _.groupBy(this.storage.tickets, 'status');
      var res = _.object(_.map(grouped, function(value, key) {
        return [key, value.length];
      }));
      this.storage.ticketsCounters = res;
      console.log('ticketsCounters set');
    }
  },

  onGetOrganizationTicketsDone: function(data) {
    var grouped = _.groupBy(data.tickets, 'status');
    var res = _.object(_.map(grouped, function(value, key) {
      return [key, value.length];
    }));
    this.storage.orgTicketsCounters = res;
    console.log('org ticketsCounters set');
  },

  onGetOrganizationFieldsDone: function(data) {
    var fields = [
      {
        key: '##builtin_tags',
        title: this.I18n.t('tags'),
        description: '',
        position: 0,
        active: true
      },
      {
        key: '##builtin_details',
        title: this.I18n.t('details'),
        description: '',
        position: Number.MAX_SAFE_INTEGER - 1,
        active: true,
        editable: this.globalStorage.orgEditable.general
      },
      {
        key: '##builtin_notes',
        title: this.I18n.t('notes'),
        description: '',
        position: Number.MAX_SAFE_INTEGER,
        active: true,
        editable: this.globalStorage.orgEditable.notes
      }
    ].concat(data.organization_fields);

    var activeFields = _.filter(fields, function(field) {
      return field.active;
    });

    var restrictedFields = _.map(activeFields, function(field) {
      return {
        key: field.key,
        title: field.title,
        description: field.description,
        position: field.position,
        selected: _.contains(this.globalStorage.selectedOrgKeys, field.key),
        editable: field.editable,
        type: field.type
      };
    }, this);

    this.globalStorage.organizationFields = _.sortBy(restrictedFields, 'position');
  },

  onGetUserFieldsDone: function(data) {
    var fields = [
      {
        key: '##builtin_tags',
        title: this.I18n.t('tags'),
        description: '',
        position: 0,
        active: true
      },
      {
        key: '##builtin_locale',
        title: this.I18n.t('locale'),
        description: '',
        position: 1,
        active: true
      },
      {
        key: '##builtin_details',
        title: this.I18n.t('details'),
        description: '',
        position: Number.MAX_SAFE_INTEGER - 1,
        active: true,
        editable: this.globalStorage.userEditable
      },
      {
        key: '##builtin_notes',
        title: this.I18n.t('notes'),
        description: '',
        position: Number.MAX_SAFE_INTEGER,
        active: true,
        editable: this.globalStorage.userEditable
      }
    ].concat(data.user_fields);

    var activeFields = _.filter(fields, function(field) {
      return field.active;
    });

    var restrictedFields = _.map(activeFields, function(field) {
      return {
        key: field.key,
        title: field.title,
        description: field.description,
        position: field.position,
        selected: _.contains(this.globalStorage.selectedKeys, field.key),
        editable: field.editable,
        type: field.type
      };
    }, this);

    this.globalStorage.userFields = _.sortBy(restrictedFields, 'position');
  }
};

export default BaseApp.extend(App);
