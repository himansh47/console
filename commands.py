# Copyright 2016 IBM Corporation
#
#   Licensed under the Apache License, Version 2.0 (the "License");
#   you may not use this file except in compliance with the License.
#   You may obtain a copy of the License at
#
#       http://www.apache.org/licenses/LICENSE-2.0
#
#   Unless required by applicable law or agreed to in writing, software
#   distributed under the License is distributed on an "AS IS" BASIS,
#   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#   See the License for the specific language governing permissions and
#   limitations under the License.

# Implementation of Amalgam8 CLI functions

import sys
import requests
import json
import sets
from urlparse import urlparse
from prettytable import PrettyTable
import os
import urllib
import datetime, time
import pprint
from parse import compile
from gremlin import ApplicationGraph, A8FailureGenerator, A8AssertionChecker


def passOrfail(result):
    if result:
        return "PASS"
    else:
        return "FAIL"

def a8_get(url, token, headers={'Accept': 'application/json'}, showcurl=False, extra_headers={}):
    headers['Authorization'] = token
    if extra_headers:
        headers=dict(headers.items() + extra_headers.items())

    if showcurl:
        curl_headers = ' '.join(["-H '{0}: {1}'".format(key, value) for key, value in headers.iteritems()])
        print "curl", curl_headers, url

    try:
        r = requests.get(url, headers=headers)
    except Exception, e:
        sys.stderr.write("Could not contact {0}".format(url))
        sys.stderr.write("\n")
        sys.stderr.write(str(e))
        sys.stderr.write("\n")
        sys.exit(2)

    if showcurl:
        print r.text

    return r

def a8_post(url, token, body, headers={'Accept': 'application/json', 'Content-type': 'application/json'}, showcurl=False, extra_headers={}):
    """
    @type body: str
    """
    headers['Authorization'] = token
    if extra_headers:
        headers=dict(headers.items() + extra_headers.items())

    if showcurl:
        curl_headers = ' '.join(["-H '{0}: {1}'".format(key, value) for key, value in headers.iteritems()])
        print "REQ:", "curl -i -X POST", url, curl_headers, "--data", '\'{0}\''.format(body.replace('\'', '\\\''))

    try:
        r = requests.post(url, headers=headers, data=body)
    except Exception, e:
        sys.stderr.write("Could not POST to {0}".format(url))
        sys.stderr.write("\n")
        sys.stderr.write(str(e))
        sys.stderr.write("\n")
        sys.exit(2)

    if showcurl:
        print "RESP: [{0}]".format(r.status_code), r.headers
        print "RESP BODY:", r.text

    return r

def a8_put(url, token, body, headers={'Accept': 'application/json', 'Content-type': 'application/json'}, showcurl=False, extra_headers={}):
    """
    @type body: str
    """
    headers['Authorization'] = token
    if extra_headers:
        headers=dict(headers.items() + extra_headers.items())

    if showcurl:
        curl_headers = ' '.join(["-H '{0}: {1}'".format(key, value) for key, value in headers.iteritems()])
        print "REQ:", "curl -i -X PUT", url, curl_headers, "--data", '\'{0}\''.format(body.replace('\'', '\\\''))

    try:
        r = requests.put(url, headers=headers, data=body)
    except Exception, e:
        sys.stderr.write("Could not PUT to {0}".format(url))
        sys.stderr.write("\n")
        sys.stderr.write(str(e))
        sys.stderr.write("\n")
        sys.exit(2)

    if showcurl:
        print "RESP: [{0}]".format(r.status_code), r.headers
        print "RESP BODY:", r.text

    return r


def a8_delete(url, token, headers={'Accept': 'application/json'}, showcurl=False, extra_headers={}):
    headers['Authorization'] = token

    if extra_headers:
        headers=dict(headers.items() + extra_headers.items())

    if showcurl:
        curl_headers = ' '.join(["-H '{0}: {1}'".format(key, value) for key, value in headers.iteritems()])
        print "curl -X DELETE", curl_headers, url

    try:
        r = requests.delete(url, headers=headers)
    except Exception, e:
        sys.stderr.write("Could not DELETE {0}".format(url))
        sys.stderr.write("\n")
        sys.stderr.write(str(e))
        sys.stderr.write("\n")
        sys.exit(2)

    return r

def get_field(d, key):
    if key not in d:
        return '***MISSING***'
    return d[key]

def fail_unless(response, code_or_codes):
    if not isinstance(code_or_codes, list):
        code_or_codes = [code_or_codes]
    if response.status_code not in code_or_codes:
        print response
        print response.text
        sys.exit(3)

def get_registry_credentials(tenant_info, args):
    registry = tenant_info["credentials"]["registry"]
    registry_url = registry["url"] if args.a8_registry_url is None else args.a8_registry_url
    registry_token = registry["token"] if args.a8_registry_token is None else args.a8_registry_token
    return registry_url, "Bearer " + registry_token

def is_active(service, default_version, instance_list):
    for instance in instance_list:
        version = instance["metadata"]["version"] if "metadata" in instance and "version" in instance["metadata"] else NO_VERSION
        if version == default_version:
            return True
    return False

NO_VERSION = "UNVERSIONED"
SELECTOR_PARSER = compile("{version}=#{rule}#") # TODO: tolerate white-space in format

############################################
# CLI Commands
############################################

def service_list(args):
    res = []

    r = a8_get('{}/v1/tenants'.format(args.a8_url), args.a8_token, showcurl=args.debug)
    fail_unless(r, 200)
    tenant_info = r.json()
    registry_url, registry_token = get_registry_credentials(tenant_info, args)
    r = a8_get('{0}/api/v1/services'.format(registry_url), registry_token, showcurl=args.debug)
    fail_unless(r, 200)
    service_list = r.json()["services"]
    for service in service_list:
        x = {}
        x['name'] = service
        x['href'] = '{0}/api/v1/services/{1}'.format(registry_url, service)
        x['versions'] = []
        x['default_version'] = NO_VERSION
        x['selectors'] = ""

        r = a8_get(x['href'], registry_token, showcurl=args.debug)
        fail_unless(r, 200)
        instance_list = r.json()["instances"]
        version_counts = {}
        for instance in instance_list:
            version = instance["metadata"]["version"] if "metadata" in instance and "version" in instance["metadata"] else NO_VERSION
            version_counts[version] = version_counts.get(version, 0) + 1

        for version, count in version_counts.iteritems():
            x['versions'].append({ 'name': version, 'num_instances': count})

        # get routing information for each service

        value = next((item for item in tenant_info['filters']['versions'] if item["service"] == service), None) # http://stackoverflow.com/a/8653568/2422749
        if value:
            default = value.get('default')
            x['default_version'] = default if default else NO_VERSION
            selectors = value.get('selectors')
            versions = []
            if selectors:
                selectors = selectors[selectors.find("{")+1:][:selectors.rfind("}")-1]
                selector_list = selectors.split(",")
                for selector in selector_list:
                    r = SELECTOR_PARSER.parse(selector.replace("{","#").replace("}","#"))
                    versions.append("%s(%s)" % (r['version'], r['rule']))
                x['selectors'] = ", ".join(versions)

        x['is_active'] = is_active(service, x['default_version'], instance_list)
        res.append(x)

    return res

def set_routing(args):
    if not args.default and not args.selector:
         print "You must specify --default or at least one --selector argument"
         sys.exit(4)

    routing_request = {}

    if args.default:
        routing_request['default'] = args.default

    if args.selector:
        selector_list = []
        for selector in args.selector:
            selector_list.append(selector.replace("(","={").replace(")","}"))
        routing_request['selectors'] = "{" + ",".join(selector_list) + "}"

    r = a8_put('{}/v1/versions/{}'.format(args.a8_url, args.service),
               args.a8_token,
               json.dumps(routing_request),
               showcurl=args.debug)
    fail_unless(r, 200)
    print 'Set routing rules for microservice', args.service

def delete_routing(args):
    r = a8_delete('{}/v1/versions/{}'.format(args.a8_url, args.service),
               args.a8_token,
               showcurl=args.debug)
    fail_unless(r, 200)
    print 'Deleted routing rules for microservice', args.service

def rules_list(args):
    r = a8_get('{0}/v1/rules'.format(args.a8_url),
               args.a8_token,
               showcurl=args.debug)
    fail_unless(r, 200)
    response = r.json()
    result_list = []
    for value in response['rules']:
        result_list.append({"id": value["id"],
                            "source": value["source"],
                            "destination": value["destination"],
                            "header": value["header"],
                            "header_pattern": value["pattern"],
                            "delay_probability": value["delay_probability"],
                            "delay": value["delay"],
                            "abort_probability": value["abort_probability"],
                            "abort_code": value["return_code"]})
    return result_list

def set_rule(args):
    if not args.source or not args.destination or not args.header:
         print "You must specify --source, --destination, and --header"
         sys.exit(4)

    rule_request = {
        "source": args.source,
        "destination": args.destination,
        "header" : args.header
    }

    if args.pattern:
        rule_request['pattern'] = '.*?'+args.pattern
    else:
        rule_request['pattern'] = '.*'

    if args.delay:
        rule_request['delay'] = args.delay
    if args.delay_probability:
        rule_request['delay_probability'] = args.delay_probability
    if args.abort_probability:
        rule_request['abort_probability'] = args.abort_probability
    if args.abort_code:
        rule_request['return_code'] = args.abort_code

    if not (args.delay > 0 and args.delay_probability > 0.0) and not (args.abort_code and args.abort_probability > 0.0):
        print "You must specify either a valid delay with non-zero delay_probability or a valid abort-code with non-zero abort-probability"
        sys.exit(4)

    payload = {"rules": [rule_request]}

    r = a8_post('{}/v1/rules'.format(args.a8_url),
                args.a8_token,
                json.dumps(payload),
                showcurl=args.debug)
    fail_unless(r, 201)
    print 'Set fault injection rule between %s and %s' % (args.source, args.destination)

def clear_rules(args):
    r = a8_delete('{}/v1/rules'.format(args.a8_url),
                  args.a8_token,
                  showcurl=args.debug)
    fail_unless(r, 200)
    print 'Cleared fault injection rules from all microservices'

def delete_rule(args):
    r = a8_delete('{}/v1/rules?id={}'.format(args.a8_url, args.rule_id),
                  args.a8_token,
                  showcurl=args.debug)
    fail_unless(r, 200)
    print 'Deleted fault injection rule with id: %s' % args.rule_id

def _print_assertion_results(results):
    x = PrettyTable(["AssertionName", "Source", "Destination", "Result", "ErrorMsg"])
    x.align = "l"
    newlist={}
    for res in results:
        res['result']=passOrfail(res['result'])
    #pprint.pprint(results)
    for check in results:
        x.add_row([get_field(check, 'name'),
                   get_field(check, 'source'),
                   get_field(check, 'dest'),
                   get_field(check, 'result'),
                   get_field(check, 'errormsg')
        ])
    return x

def run_recipe(args):
    if not args.topology or not args.scenarios:
        print "You must specify --topology and --scenarios"
        sys.exit(4)

    if args.header:
        header = args.header
    else:
        header = "X-Request-ID"

    if args.pattern:
        pattern = args.pattern
    else:
        pattern = '*'

    if not args.topology:
        print u"Topology required"
        sys.exit(4)

    if not args.scenarios:
        print u"Failure scenarios required"
        sys.exit(4)

    if args.checks and not args.checks:
        print u"Checklist file required"
        sys.exit(4)

    print args.topology

    topology = ApplicationGraph(json.loads(args.topology))
    scenarios = json.loads(args.scenarios)
    checklist = json.loads(args.checks)

    fg = A8FailureGenerator(topology, a8_url='{0}/v1/rules'.format(args.a8_url), a8_token=args.a8_token,
                            header=header, pattern='.*?'+pattern, debug=args.debug)
    fg.setup_failures(scenarios)
    start_time = datetime.datetime.utcnow().isoformat()
    print start_time
    print 'Inject test requests with HTTP header %s matching the pattern %s' % (header, pattern)
    if args.checks:
        if args.run_load_script:
            import subprocess
            with open("/tmp/loadscript.sh", "w") as fp:
                fp.write(args.run_load_script)
            subprocess.call(['chmod +x /tmp/loadscript.sh'])
            subprocess.call(['/tmp/loadscript.sh'])
        else:
            print ('When done, press Enter key to continue to validation phase')
            a = sys.stdin.read(1)
        #sleep for 3sec to make sure all logs reach elasticsearch
        time.sleep(3)
        end_time=datetime.datetime.utcnow().isoformat()
        print end_time
        #sleep for some more time to make sure all logs have been flushed
        time.sleep(5)
        log_server = checklist.get('log_server', args.a8_log_server)
        ac = A8AssertionChecker(es_host=log_server, header=header, pattern=pattern, start_time=start_time, end_time=end_time, debug=args.debug)
        results = ac.check_assertions(checklist, continue_on_error=True)

        #clear_rules(args)

        return results

        # for check in results:
        #     print 'Check %s %s %s' % (check.name, check.info, passOrfail(check.success))
        # if not check.success:
        #     exit_status = 1
        # sys.exit(exit_status)
