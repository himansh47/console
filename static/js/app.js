"use strict";
var $http = window.axios;

String.prototype.hashCode = function() {
  var hash = 0, i, chr, len;
  if (this.length === 0) return hash;
  for (i = 0, len = this.length; i < len; i++) {
    chr   = this.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

$(document).ready(function(){

  // initialize bootstrap notify component
  $.notifyDefaults({
    element: 'body',
    position: null,
    type: "info",
    allow_dismiss: true,
    newest_on_top: false,
    placement: {
      from: "top",
      align: "right"
    },
    offset: 20,
    spacing: 10,
    z_index: 1031,
    delay: 3000,
    timer: 1000,
    url_target: '_blank',
    mouse_over: null,
    animate: {
      enter: 'animated fadeInDown',
      exit: 'animated fadeOutUp'
    },
    onShow: null,
    onShown: null,
    onClose: null,
    onClosed: null,
    icon_type: 'class',
    template: '<div data-notify="container" class="col-xs-11 col-sm-3 alert alert-{0}" role="alert"><button type="button" aria-hidden="true" class="close" data-notify="dismiss">&times;</button><span data-notify="icon"></span> <span data-notify="title">{1}</span> <span data-notify="message">{2}</span><div class="progress" data-notify="progressbar"><div class="progress-bar progress-bar-{0}" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div></div><a href="{3}" target="{4}" data-notify="url"></a></div>'
  });

  $http.defaults.headers.post['Content-Type'] = 'application/json';
  $http.defaults.headers.common['Accept'] = 'application/json';
  var LIST_SEPARATOR = ", ";

  /*
   * cheap and dirty jQuery hash based router
   */
  function Router(changePageFn, pagelinkClass)
  {
    pagelinkClass = pagelinkClass || ".pagelink";
    var self = this;
    self.changePage = changePageFn; // callback

    $(pagelinkClass).on("click", function(e) {
      var target = e.target.href.split('#')[1];
      self.changePage(target);
    });
  }

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

    this.asPercent = function(v) {
      return v + "%";
    };

    this.weight = ko.observable(this.value * 100); // TODO: bug in ko-slider preventing using ES5 property. Force to observable
  }

  function Rule(rule) {
      this.active = true;
      this.id = rule.id || 0;
      this.abort_code = rule.abort_code || 0;
      this.abort_probability = (100 * rule.abort_probability) || 0;
      this.delay = rule.delay || 0;
      this.delay_probability = (100 * rule.delay_probability) || 0;
      this.destination = rule.destination || "";
      this.header = rule.header || "Cookie";
      this.header_pattern = rule.header_pattern || "";
      this.source = rule.source || "";

      ko.track(this);

      // TODO: hack for slider component - needs observable and not es5 object
      this.slider_delay_probability = ko.observable(this.delay_probability);
      this.slider_abort_probability = ko.observable(this.abort_probability);

      this.asPercent = function(v) {
        return v + "%";
      };

  }

  function FileVM() {
    var self = this;
    this.filename = "";
    this.data = "";

    this.onSelected = function(data, e) {
      var reader  = new FileReader();
      var f = e.target.files[0];

      self.filename = f.name;
      reader.onloadend = function (onloadend_e)
      {
         var result = reader.result;
         self.data = result;
      };

      if(f)
      {
          reader.readAsText(f);
      }
    };

    ko.track(this);
  }

  function Recipe() {
      this.running = false;
      this.header = "Cookie";
      this.header_pattern = "";
      this.topology = new FileVM();
      this.scenarios = new FileVM();
      this.checks = new FileVM();
      this.load_script = new FileVM();
      ko.track(this);
  }

  function TestResult() {
    this.id = Date.now();
    this.start_time = 0;
    this.end_time = 0;
    this.elapsed_time = 0;
    this.results = [];

    this.header = function() {
      return (new Date(this.start_time)).toString();
    };
  }

  function viewModel() {
    var self=this;
    this.selectedRule = new Rule({});
    this.recipe = new Recipe();

    this.testResults = [];

    this.services = [];
    this.rules = [];
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

    this.srcdstList = function() {
      var srcdst = [];
      this.services.forEach(function(service) {
        service.versions.forEach(function(v) {
          srcdst.push(service.name + ':' + v.name);
        });
      });

      return srcdst;
    };

    this.newRecipe = function() {
      //this.recipe = new Recipe();
      $('#collapseRecipe').collapse('toggle');
    };
    this.cancelRecipe = function() {
      //this.selectedRule = new Rule({});
      $('#collapseRecipe').collapse('hide');
    };
    this.runRecipe = function() {
      /*
      this.recipe.running = true;
      $.notify({
        // options
        message: 'Uploading &amp; Running Recipe...'
      },{
        // settings
        type: 'warning'
      });
      */
      var testResult = new TestResult();
      testResult.start_time = Date.now();

      var data = {
        topology: this.recipe.topology.data,
        scenarios: this.recipe.scenarios.data,
        checks: this.recipe.checks.data,
        //load_script: this.recipe.load_script.data,
        header: this.recipe.header,
        header_pattern: this.recipe.header_pattern
      }
      var config = {
        url: '/api/v1/recipes',
        method: 'post',
        data: data
      }
      $http.request(config).then(function(res) {
        var msg = 'Inject test requests with HTTP header <strong><em>' + config.data.header + '</em></strong> matching the pattern <strong><em>' + config.data.header_pattern + '</em></strong>. Press <strong><em>Validate Recipe</em></strong> when ready to continue to validation phase';
        bootbox.alert({
          message: msg,
          title: 'Inject Test Requests',
          callback: validateRecipe,
          closeButton: false,
          buttons: {
            'ok': {
              label: 'Validate Recipe',
              className: 'btn-info'
            }
          }
        });

        function validateRecipe() {
          self.recipe.running = true;
          config = {
              url: '/api/v1/recipe-results',
              method: 'post',
              data: JSON.parse(res.data.context)
          }

          $http.request(config).then(function(res) {
            self.recipe.running = false;
            $.notify({
              // options
              message: 'Recipe Test Results Posted...'
            },{
              // settings
              type: 'success'
            });

            testResult.end_time = Date.now();
            testResult.elapsed_time = Math.round((testResult.end_time - testResult.start_time) / 1000);
            testResult.results = res.data.rules;
            self.testResults.unshift(testResult);
          });
        }
      });
    };

    this.newRule = function() {
      this.selectedRule = new Rule({});
      $('#collapseRules').collapse('toggle');
    };
    this.cancelRule = function() {
      this.selectedRule = new Rule({});
      $('#collapseRules').collapse('hide');
    };
    this.createRule = function() {
      var data = {
        source: this.selectedRule.source,
        destination: this.selectedRule.destination,
        header: this.selectedRule.header,
        header_pattern: this.selectedRule.header_pattern,
        delay_probability: this.selectedRule.slider_delay_probability() * 1.0 / 100,
        delay: Number(this.selectedRule.delay),
        abort_probability: this.selectedRule.slider_abort_probability() * 1.0 / 100,
        abort_code: Number(this.selectedRule.abort_code)
      }
      var config = {
        url: '/api/v1/rules',
        method: 'post',
        data: data
      }
      $http.request(config).then(function(res) {
        console.log(res);
      });

      $('#collapseRules').collapse('hide');
    };

    this.deleteRule = function(rule) {
      $.notify({
      	// options
      	message: 'Deleting rule...'
      },{
      	// settings
      	type: 'warning'
      });

      rule.active = false;
      var config = {
        url: '/api/v1/rules/' + rule.id,
        method: 'delete'
      }
      $http.request(config).then(function(res) {
        // TODO: check status = 200
      });
    };

    this.deleteRules = function() {
      $.notify({
      	// options
      	message: 'Deleting all fault rules...'
      },{
      	// settings
      	type: 'danger'
      });

      var config = {
        url: '/api/v1/rules',
        method: 'delete'
      }
      $http.request(config).then(function(res) {
        // TODO: check status = 200
      });
    };

    ko.track(this);

    // hash values of lists to be used to compare with AJAX responses
    // these don't need to be observables - see doPoll()
    self.servicesHash = 0;
    self.rulesHash = 0;

    // connect up the Router - es5 properties not working so use observables
    // TODO: selection of initial page is naive and only works with three pages. Fix later.
    var page = '/routes';
    if (window.location.hash == '#/rules') page = '/rules';
    if (window.location.hash == '#/recipe') page = '/recipe';
    if (window.location.hash == '#/testresults') page = '/testresults';

    self.currentPage = ko.observable(page);
    self.changePage = function(page) {
      $('#collapseRules').collapse('hide');
      $('#collapseRoutes').collapse('hide');

      self.currentPage(page);
    };

    var router = new Router(self.changePage);

    // elements that don't need to be tracked as observables
    this.SELECTORTYPES = ['weight', 'user', 'header', '--raw text--'];

    function doPoll() {
      $http.request({url: '/api/v1/services'}).then(function(res) {
        if (res.status !== 200) console.log(res);

        var services = []
        res.data.services.forEach(function(service) {
          services.push(new Service(service));
        });

        services.sort(function(a,b) { return a.name > b.name ? 1 : (a.name < b.name ? -1 : 0);});

        //
        // IMPERFECT diff function. We take the sorted list of services, convert to JSON, and do a hash.
        // Since there are no IDs for services this was the best we could do other than an attribute-wise compare
        // (which would be more accurate but slower and more complex)
        //
        var newHash = JSON.stringify(services).hashCode();
        if (newHash !== self.servicesHash) {
          console.log("updating services");
          self.servicesHash = newHash;
          self.services = services;
        }
      });

      $http.request({url: '/api/v1/rules'}).then(function(res) {
        if (res.status !== 200) console.log(res);

        var rules = [];
        res.data.rules.forEach(function(rule) {
          rules.push(new Rule(rule));
        });

        rules.sort(function(a,b) { return a.source > b.source ? 1 : (a.source < b.source ? -1 : 0);});

        //
        // IMPERFECT diff function. We take the sorted list of rules, convert to JSON, and do a hash.
        // We could compare rule IDs here instead but do not know if ID changes when rule is updated, etc.
        //
        // TODO: refactor code since this is basically same as how services hash is handled
        //

        var newHash = JSON.stringify(rules).hashCode();
        if (newHash !== self.rulesHash) {
          console.log("updating rules");
          self.rulesHash = newHash;
          self.rules = rules;
        }
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
