(function() {
  return {

    storage: {
      user: null,
      ticketsCounters: {
      },
      requestsCount: 0,
      fields: [],
      selectedKeys: []
      // hello
    },

    events: {
      // App
      'app.activated': 'onAppActivation',

      // Requests
      'getUser.done': 'onGetUserDone',
      'getUserFields.done': 'onGetUserFieldsDone',
      'getTickets.done': 'onGetTicketsDone',

      // UI
      'click .expandBar': 'onClickExpandBar',
      'click .cog': 'onCogClick',
      'click .back': 'onBackClick',
      'click .save': 'onSaveClick',

      // Misc
      'requestsFinished': 'onRequestsFinished'
    },

    requests: {
      'getUser': function(id) {
        return {
          url: helpers.fmt("/api/v2/users/%@.json?include=identities,organizations", id),
          dataType: 'json',
          proxy_v2: true
        };
      },

      'getUserFields': {
        url: '/api/v2/user_fields.json',
        proxy_v2: true
      },

      'searchTickets': function(cond) {
        return {
          url: helpers.fmt("/api/v2/search.json?query=type:ticket %@", cond),
          dataType: 'json',
          proxy_v2: true
        };
      },

      'getTickets': function(userId) {
        return {
          url: helpers.fmt("/api/v2/users/%@/tickets/requested.json", userId),
          proxy_v2: true
        };
      },

      'saveSelectedFields': function(keys) {
        var appId = this.installationId();
        var fieldsString = JSON.stringify(_.toArray(keys));
        if (!appId) {
          this.settings.selectedFields = fieldsString;
        }
        return {
          type: 'PUT',
          url: helpers.fmt("/api/v2/apps/installations/%@.json", appId),
          dataType: 'json',
          data: {
            'settings': {'selectedFields': fieldsString},
            'enabled': true
          }
        };
      }
    },

    // TOOLS ===================================================================

    // Implement the partial() method of underscorejs, because 1.3.3 doesn't
    // include it.
    partial: function(func) {
      var args = Array.prototype.slice.call(arguments, 1);
      return function() {
        return func.apply(this,
                          args.concat(Array.prototype.slice.call(arguments)));
      };
    },

    // Implement the object() method of underscorejs, because 1.3.3 doesn't
    // include it. Simplified for our use.
    toObject: function(list) {
      if (list == null) return {};
      var result = {};
      for (var i = 0, l = list.length; i < l; i++) {
        result[list[i][0]] = list[i][1];
      }
      return result;
    },

    countedAjax: function() {
      this.storage.requestsCount++;
      return this.ajax.apply(this, arguments).always((function() {
        _.defer((this.finishedAjax).bind(this));
      }).bind(this));
    },

    finishedAjax: function() {
      if (--this.storage.requestsCount === 0) {
        this.trigger('requestsFinished');
      }
    },

    fieldsForCurrentUser: function() {
      return _.map(this.storage.selectedKeys, (function(key) {
        var result = { key: key };
        if (key.indexOf('##builtin') === 0) {
          var name = key.split('_')[1];
          result.value = this.storage.user[name];
          result.title = this.I18n.t(name);
        }
        else {
          var field = _.find(this.storage.fields, function(field) {
            return field.key === key;
          });
          result.title = field.title;
          result.description = field.description;
          result.value = this.storage.user.user_fields[key];
        }
        return result;
      }).bind(this));
    },

    showDisplay: function() {
      this.switchTo('display', {
        ticketId: this.ticket().id(),
        isAdmin: this.currentUser().role() === 'admin',
        user: this.storage.user,
        tickets: this.storage.ticketsCounters,
        fields: this.fieldsForCurrentUser()
      });
      this.$('.field[key="##builtin_tags"] h4').html("<i class='icon-tag''/>");
    },

    // EVENTS ==================================================================

    onAppActivation: function() {
      _.defer((function() {
        var defaultSelection = '["##builtin_tags", "##builtin_notes", "##builtin_details"]';
        this.storage.selectedKeys = JSON.parse(this.setting('selectedFields') || defaultSelection);
        if (this.ticket().requester()) {
          this.countedAjax('getUser', this.ticket().requester().id());
        }
        this.countedAjax('getUserFields');
      }).bind(this));
    },

    onRequestsFinished: function() {
      var ticketsCounters = this.storage.ticketsCounters;
      _.each(['new', 'open', 'hold', 'pending', 'solved', 'closed'], function(key) {
        if (!ticketsCounters[key]) {
          ticketsCounters[key] = '-';
        }
      });
      this.showDisplay();
    },

    onClickExpandBar: function() {
      var additional = this.$('.additional');
      var expandBar = this.$('.expandBar span');
      expandBar.attr('class', 'ui-icon');
      if (additional.is(':visible')) {
        additional.slideUp();
        expandBar.addClass('ui-icon-triangle-1-s');
      }
      else {
        additional.slideDown();
        expandBar.addClass('ui-icon-triangle-1-n');
      }
    },

    onCogClick: function() {
      var html = this.renderTemplate('admin', {
        fields: this.storage.fields
      });
      this.$('.admin').html(html);
      var height = _.max([this.$('.admin').outerHeight(),
                          this.$('.whole').outerHeight()]) + 50;
      this.$('div[data-main]').height(height);
      this.$('div[data-main]').addClass('effect');
      _.defer((function() {
        this.$('div[data-main]').addClass('open');
      }).bind(this));
    },

    onBackClick: function() {
      this.$('div[data-main]').height('auto').removeClass('effect open');
    },

    onSaveClick: function() {
      var that = this;
      var keys = this.$('input:checked').map(function() { return that.$(this).val(); });
      this.$('input, button').prop('disabled', true);
      this.$('.save').hide();
      this.$('.waitSpin').show();
      this.ajax('saveSelectedFields', keys)
        .always(this.onBackClick.bind(this))
        .always(this.onAppActivation.bind(this));
    },

    // REQUESTS ================================================================

    onGetUserDone: function(data) {
      this.storage.user = data.user;
      var social = _.filter(data.identities, function(ident) {
        return _.contains(['twitter', 'facebook'], ident.type);
      });
      this.storage.user.identities = _.map(social, function(ident) {
        if (ident.type === 'twitter') {
          ident.value = helpers.fmt("https://twitter.com/%@", ident.value);
        } else if (ident.type === 'facebook') {
          ident.value = helpers.fmt("https://facebook.com/%@", ident.value);
        }
        return ident;
      });
      this.storage.user.organization = data.organizations[0];
      if (data.user.email) {
        this.countedAjax('getTickets', this.storage.user.id);
      }
    },

    onGetTicketsDone: function(data) {
      var grouped = _.groupBy(data.tickets, 'status');
      var res = this.toObject(_.map(grouped, function(value, key) {
        return [key, value.length];
      }));
      this.storage.ticketsCounters = res;
    },

    onGetUserFieldsDone: function(data) {
      var selectedFields = this.storage.selectedKeys;
      var fields = [
        {
          key: "##builtin_tags",
          title: this.I18n.t("tags"),
          description: "",
          position: 0,
          active: true
        },
        {
          key: "##builtin_notes",
          title: this.I18n.t("notes"),
          description: "",
          position: Number.MAX_VALUE - 1,
          active: true
        },
        {
          key: "##builtin_details",
          title: this.I18n.t("details"),
          description: "",
          position: Number.MAXVALUE,
          active: true
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
          selected: _.contains(selectedFields, field.key)
        };
      });
      this.storage.fields = _.sortBy(restrictedFields, 'position');
    }
  };
}());
