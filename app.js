(function() {
  return {
    searchableTicketStatuses: ['', 'new', 'open','pending', 'hold', 'solved', 'closed'],
    defaultState: 'list',
    requests: {
      fetchUser: function(id) {
        return {
          url: '/api/v2/users/' + id + '.json?include=organizations',
          proxy_v2: true,
          dataType: 'json'
        };
      },

      fetchUserRequests: function(id){
        return {
          url: '/api/v2/users/' + id + '/requests.json',
          proxy_v2: true,
          dataType: 'json'
        };
      },

      updateUser: function(id, data){
        return {
          url: '/api/v2/users/' + id + '.json',
          type: 'PUT',
          proxy_v2: true,
          dataType: 'json',
          data: data
        };
      },

      fetchTicketAudits: function(id){
        return {
          url: '/api/v2/tickets/' + id + '/audits.json',
          proxy_v2: true,
          dataType: 'json'
        };
      },

      fetchLocale: function(id){
        return {
          url: '/api/v2/locales/' + id +'.json',
          proxy_v2: true,
          dataType: 'json'
        };
      },

      searchTickets: function(condition){
        return {
          url: '/api/v2/search.json?query=type:ticket '+ condition,
          proxy_v2: true,
          dataType: 'json'
        };
      }
    },

    events: {
      /*
       *  APP EVENTS
       */
      'app.activated'                   : 'onActivated',
      'ticket.requester.id.changed'     : 'initializeIfReady',
      'ticket.requester.email.changed'  : 'initializeIfReady',
      /*
       *  AJAX EVENTS
       */
      'fetchUser.done'                  : 'fetchUserDone',
      'fetchTicketAudits.done'          : 'fetchTicketAuditsDone',
      'fetchLocale.done'                : function(data){ this.renderUserLocale(data.locale); },
      'updateUser.done'                 : function(){ services.notify(this.I18n.t("update_user_done")); },
      'fetchUserRequests.done'          : function(data){ this.renderTicketCount('user',data.count); },

      'fetchTicketAudits.fail'          : 'genericAjaxFailure',
      'fetchLocale.fail'                : 'genericAjaxFailure',
      'updateUser.fail'                 : 'genericAjaxFailure',
      'fetchUser.fail'                  : 'genericAjaxFailure',
      'fetchUserRequests.fail'          : 'genericAjaxFailure',
      /*
       *  DOM EVENTS
       */
      'click header'                    : function(){ this.toggleApp(); },
      'change,keyup,input,paste textarea.details_or_notes': 'detailsOrNotesChanged',
      'click a.details_and_notes'       : function(){ this.toggleDetailsAndNotes(); },
      'click a.organization'            : function(){ this.toggleOrganization(); }
    },

    onActivated: function(data) {
      this.doneLoading = false;
      this.initializeIfReady();
    },

    initializeIfReady: function(){
      if (!this.isReady())
        return;

      this.initialize();
      this.doneLoading = true;
    },

    isReady: function(){
      return(!this.doneLoading &&
             this.ticket() &&
             this.ticket().requester());
    },

    initialize: function(){
      this.ajax('fetchUser', this.ticket().requester().id());
      if (this.ticket().id()) { this.ajax('fetchTicketAudits', this.ticket().id()); }

      if (this.setting('unfolded_on_startup')){
        this.$('section[data-main]').show();
        services.appsTray().show();
      }
    },

    /*
     * VIEW RENDERING
     */
    renderUser: function(params){
      this.$('section[data-user]')
        .html(this.renderTemplate('user', params));

      this.$('section[data-details-notes]')
        .html(this.renderTemplate('details-notes', {
          details: params.user.details,
          notes: params.user.notes
        }));
    },

    renderUserLocale: function(locale){
      var locale_for_flag = locale.locale.split('-');
      locale_for_flag = locale_for_flag[1] || locale_for_flag[0];

      if(_.isEmpty(locale_for_flag))
        return;

      return this.$('section[data-user] i.locale')
        .addClass('flag-' + locale_for_flag.toLowerCase())
        .attr("title", locale.name + ' ('+locale.locale+')');
    },

    renderSpokeTicket: function(params){
      return this.$('section[data-spoke-ticket]')
        .html(this.renderTemplate('spoke-ticket', params));
    },

    renderTicketCount: function(entity, count, type){
      var el = this.$('section[data-'+entity+']');
      var selector = helpers.fmt('.ticket_details .ticket-count-%@', type);
      if (count === 0) {
        count = "-";
      }

      this.$(selector).html(count);
    },

    renderOrganization: function(params){
      return this.$('section[data-organization]')
        .html(this.renderTemplate('organization', params));
    },

    toggleApp: function(){
      var app = this.$('section[data-main]');

      if (app.is(':visible')){
        app.hide();
        this.$('h3 i').attr('class', 'icon-plus');
      } else {
        app.show();
        this.$('h3 i').attr('class', 'icon-minus');
      }
    },

    toggleDetailsAndNotes: function(){
      return this.$('section[data-details-notes] .details-notes').toggle();
    },

    toggleOrganization: function(){
      return this.$('section[data-organization] .well').toggle();
    },


    /*
     * RESPONSE TO EVENTS
     */
    fetchUserDone: function(data){
      var user = data.user;
      var organization = data.organizations[0];
      var ticket =  { id: this.ticket().id() };

      this.fetchUserMetrics(user);
      this.ajax('fetchLocale', user.locale_id);

      this.renderUser({
        user: user,
        ticket: ticket,
        user_has_organization: !!organization
      });

      if (organization){
        this.renderOrganization({
          organization: organization,
          ticket: ticket
        });
        this.fetchOrganizationMetrics(organization);
      }
    },

    fetchTicketAuditsDone: function(data){
      _.each(data.audits, function(audit){
        _.each(audit.events, function(e){

          if (this.auditEventIsSpoke(e)){
            var spokeData = this.spokeData(e);

            if (spokeData){
              this.$('section[data-user] span.email')
                .html(spokeData.email);
              return this.renderSpokeTicket(spokeData);
            }
          }
        }, this);
      }, this);
    },

    auditEventIsSpoke: function(event){
      return event.type === "Comment" &&
        /spoke_id_/.test(event.body);
    },

    spokeData: function(event){
      var data = /spoke_id_(.*)\nspoke_account_(.*)\nrequester_email_(.*)\nrequester_phone_(.*)/.exec(event.body);

      if (_.isEmpty(data))
        return false;

      return {
        id: data[1].trim(),
        account: data[2].trim(),
        email: data[3].trim(),
        phone: data[4].trim()
      };
    },

    genericAjaxFailure: function(data){
      services.notify(this.I18n.t("ajax_error"), 'error');
    },

    detailsOrNotesChanged: _.debounce(function(){
      this.ajax('updateUser', this.ticket().requester().id(), {
        user: {
          details: this.$('.details').val(),
          notes: this.$('.notes').val()
        }
      });
    }, 400),

    fetchUserMetrics: function(user){
      if (_.isEmpty(user.email))
        return;

      _.each(this.searchableTicketStatuses, function(status){
        var condition = (_.isEmpty(status) ? '' : 'status:' + status + ' ') +
          'requester:' + user.email;

        this.ajax('searchTickets', condition)
          .done(function(data) {
            this.renderTicketCount('user', data.count, status);
          });
      }, this);
    },

    fetchOrganizationMetrics: function(organization){
      _.each(this.searchableTicketStatuses, function(status){
        var condition = (_.isEmpty(status) ? '' : 'status:' + status + ' ') +
          'organization:"' + organization.name + '"';

        this.ajax('searchTickets', condition)
          .done(function(data) {
            this.renderTicketCount('organization', data.count, status);
          });
      }, this);
    }
  };
}());
