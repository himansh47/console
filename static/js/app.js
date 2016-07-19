"use strict";
var $http = window.axios;

$(document).ready(function(){
  $http.defaults.headers.post['Content-Type'] = 'application/json';
  $http.defaults.headers.common['Accept'] = 'application/json';
  var LIST_SEPARATOR = ", ";

  var UNVERSIONED = "UNVERSIONED";
  function getVersionOptions(versions) {
    var res = []
    versions.forEach(function(v) {
      res.push(v.name);
    });

    return res;
  }

  function Service(service) {
    this.name = service ? service.name : '';
    this.href = service ? service.href : '';
    this.versions = service ? service.versions : [];
    this.defaultVersion = service ? service.default_version : UNVERSIONED;
    this.versionSelectors = service ? service.selectors : '';
    this.isActive = service ? service.is_active : false;

    this.versionText = function() {
      var instances = [];
      this.versions.forEach(function(v) {
        instances.push(v.name + "(" + v.num_instances + ")");
      });
      return instances.join(LIST_SEPARATOR);
    };

    ko.track(this);
  }

  function Selector(s) {
    var re = /([a-zA-z].+)\((.+)=(.+)\)/i
    var match = s.match(re);

    this.rule = s;
    this.version = match ? match[1].trim().toLowerCase() : '';
    this.type = match ? match[2].trim().toLowerCase() : '';
    var value = match ? match[3].trim() : '';
    this.pattern = '';
    
    if (this.type == 'user') {
      this.value = value.substring(1,value.length-1)
    }
    else if (this.type == 'header') {
      var colon = value.indexOf(':')
      this.value = value.substring(1, colon)
      this.pattern = value.substring(colon+1, value.length-1)
    }
    else if (this.type == 'weight') {
      this.value = value
    }
    else {
      this.type = '--raw text--'
      this.value = this.rule
    }

    ko.track(this);

    // elements that do not need to be tracked as observables
    this.toString = function() {
      if (this.type === 'weight') this.value = (this.weight() / 100).toPrecision(2);
      this.createRule();
      return this.rule;
    };

    this.createRule = function() {
      var value = this.value
      if (this.type == '--raw text--') {
        this.rule = value
      }
      else {
        if (this.type == 'user') {
          value = '"' + value + '"'
        }
        else if (this.type == 'header') {
          value = '"' + value + ':' + this.pattern + '"'
        }
        this.rule = this.version + "(" + this.type + "=" + value + ")";
      }
    };

    this.weight = ko.observable(this.value * 100); // TODO: bug in ko-slider preventing using ES5 property. Force to observable
  }

  function viewModel() {
    var self=this;
    this.services = [];
    this.selectedService = new Service();
    this.versions = [];
    this.selectedVersion = '';
    this.selectors = [];

    this.addSelector = function() {
      this.selectors.push(new Selector(''));
    };

    this.deleteSelector = function(s) {
      this.selectors.remove(s);
    }

    this.editRoutes = function(service) {
      this.selectedService = service;
      this.versions = getVersionOptions(service.versions);
      this.selectedVersion = service.defaultVersion;
      this.selectors.removeAll();
      service.versionSelectors.split(',').forEach(function(s) {
          self.selectors.push(new Selector(s.trim()));
      });
      $('#collapseRoutes').collapse('show');
    };

    // TODO - add error checking for non-selected version, no value field, etc.
    this.modifyRoutes = function() {
      var selectors = this.selectors.join(',').trim();
      var data = { service: this.selectedService.name }
      if (this.selectedVersion)
        data.default_version = this.selectedVersion;

      if (selectors)
        data.version_selectors = selectors;

      var config = {
        url: '/api/v1/routes',
        method: 'post',
        data: data
      }
      $http.request(config).then(function(res) {
        console.log(res);
      });

      $('#collapseRoutes').collapse('hide');
    };
    this.cancelRoutes = function() {
      this.selectedVersion = this.selectedService.defaultVersion;
      this.selectors.removeAll();
      $('#collapseRoutes').collapse('hide');
    };

    ko.track(this);

    // elements that don't need to be tracked as observables
    this.SELECTORTYPES = ['weight', 'user', 'header', '--raw text--'];

    function doPoll() {
      $http.request({url: '/api/v1/services'}).then(function(res) {
        if (res.status !== 200) console.log(res);

        var services = []
        res.data.services.forEach(function(service) {
          services.push(new Service(service));
        });

        services.sort(function(a,b) { return a.name > b.name;});
        self.services = services;
      });
    }

    // recursive polling approach so AJAX return in defined order
    // based on: https://techoctave.com/c7/posts/60-simple-long-polling-example-with-javascript-and-jquery
    (function poll() {
      setTimeout(function() {
        doPoll();
        poll();
      }, 5000);
    })();

    doPoll(); // initial one to get us started
  };

  ko.vm = new viewModel();
  ko.punches.enableAll();
  ko.applyBindings(ko.vm);
});
