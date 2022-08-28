const sip = require('sip')
const sip_parsing = require('sip-parsing')
const {compact_headers} = require('sip-parsing')

const _ = require('lodash')

const get_header = (name, msg) => {
    var res = msg.headers[name.toLowerCase()]
    if(Array.isArray(res)) {
        return res[0]
    }
    return res
}

const get_header_by_index = (name, index, msg) => {
    var items = msg.headers[name.toLowerCase()]
    if(items == undefined) return undefined

    if(!Array.isArray(items)) {
        items = [items]
    }

    if(items.length == 0) return undefined;

    var item = undefined;
    
    if(index == '-1') {
        item = items[items.length -1]
        if(item) return item
    } else if(index == '*') {
        return items
    } else {
        index = parseInt(index)
        if(Number.isInteger(index) && index >= 0) {
            item = items[index]
            if(item) return item
        }
    }

    return undefined;
}

const unquote = (s) => {
    return s.replaceAll(/^"|"$/g, '')
}

const length = (s) => {
    return s.length
}

const not_found = () => {}

const _get = (item, path) => {
    console.log(`_get path=${path}`)
    if(path.length == 0) {
        return item
    } 

    var head = path[0]
    var tail = path.slice(1)

    if(typeof item == 'object') {
        if(item.hasOwnProperty(head)) {
            console.log(`p1 item=${JSON.stringify(item)} head=${head}`)
            return _get(item[head], tail) 
        } else {
            console.log(`p2 ${head} not_found`)
            return not_found
        }
    } else if(typeof head == 'function') {
        console.log("p3 head is function")
        return _get(head(item), tail)
    } else {
       console.log(`p4 item=${JSON.stringify(item)} tail=${JSON.stringify(tail)}`)
       return not_found
    }
}

const get_from_auth = (msg, param) => {
    var items = msg.headers['authorization']
    if(!items) {
        items = msg.headers['proxy-authorization']
    }
    if(!items) return undefined

    var item = items[0]

    if(param == "user" || param == "domain") {
        if(!item.hasOwnProperty(param)) {
            if(item.uri) {
                var a = unquote(item.username).split("@")
                item.user = a[0]
                item.domain = a[1]
            }
        }
    }

    var res = item[param]
    if(res) {
        return unquote(res)
    }
    return undefined
}

const get = (msg, path, parser) => {
    var res = _get(msg, path)
    if(res == not_found) {
        if(parser) {
            parser(msg)
            res = _get(msg, path)
            if(res == not_found) {
                res = undefined
            }
        } else {
            res = undefined
        }
    }
    return res
}

const parse_request_uri = (msg) => {
    console.log(`parse_request_uri msg.uri=${msg.uri}`)
    if(!msg.uri) return

    msg.request_uri = sip.parseUri(msg.uri)
    console.log(`msg.request_uri=${JSON.stringify(msg.request_uri)}`)
}

const parse_header_uri = (header_name, msg) => {
    var header = msg.headers[header_name]
    if(!header) return

    var p = sip.parseUri(header.uri)
    
    msg.headers[header_name].uri_username = p.user
    msg.headers[header_name].uri_domain = p.host
}

const parse_crude_uri = (header_name, msg) => {
    console.log(`parse_crude_uri ${header_name}`)
    var header = msg.headers[header_name]
    if(!header) return

    var p = sip_parsing.parse_displayname_and_uri(header)
    msg.headers[header_name] = {
        name: p.displayname,
        uri: p.uri,
        params: p.params,
    }

    parse_header_uri(header_name, msg)
    console.log(JSON.stringify(msg.headers[header_name]))
}

const partial = (fu, name) => {
    return (msg) => {
        return fu(name, msg)
    }
}

const parse_from_uri = partial(parse_header_uri, 'from')
const parse_to_uri = partial(parse_header_uri, 'to')
const parse_ppi = partial(parse_crude_uri, 'p-preferred-identity')
const parse_pai = partial(parse_crude_uri, 'p-asserted-identity')
const parse_rpi = partial(parse_crude_uri, 'remote-party-id')
const parse_diversion = partial(parse_crude_uri, 'diversion')

const base_pseudovar_accessors = {

    $fn: (msg) => { return get(msg, ['headers', 'from', 'name']) },
    $fu: (msg) => { return get(msg, ['headers', 'from', 'uri']) },
    $fU: (msg) => { return get(msg, ['headers', 'from', 'uri_username'], parse_from_uri) },
    $fd: (msg) => { return get(msg, ['headers', 'from', 'uri_domain'], parse_from_uri) },
    $ft: (msg) => { return get(msg, ['headers', 'from', 'params', 'tag']) },
    $fUl:(msg) => { return get(msg, ['headers', 'from', 'uri_username', length]) },

    $tn: (msg) => { return get(msg, ['headers', 'to', 'name']) },
    $tu: (msg) => { return get(msg, ['headers', 'to', 'uri']) },
    $tU: (msg) => { return get(msg, ['headers', 'to', 'uri_username'], parse_to_uri) },
    $td: (msg) => { return get(msg, ['headers', 'to', 'uri_domain'], parse_to_uri) },
    $tt: (msg) => { return get(msg, ['headers', 'to', 'params', 'tag']) },

    $pn: (msg) => { return get(msg, ['headers', 'p-preferred-identity', 'name'], parse_ppi) }, 
    $pu: (msg) => { return get(msg, ['headers', 'p-preferred-identity', 'uri'], parse_ppi) },
    $pU: (msg) => { return get(msg, ['headers', 'p-preferred-identity', 'uri_username'], parse_ppi) },
    $pd: (msg) => { return get(msg, ['headers', 'p-preferred-identity', 'uri_domain'], parse_ppi) },

    $adu: (msg) => { return get_from_auth(msg, 'uri') },
    $aa : (msg) => { return get_from_auth(msg, 'algorithm') },
    $ar : (msg) => { return get_from_auth(msg, 'realm') },
    $au : (msg) => { return get_from_auth(msg, 'user') },
    $ad : (msg) => { return get_from_auth(msg, 'domain') },
    $aU : (msg) => { return get_from_auth(msg, 'username') },
    $an : (msg) => { return get_from_auth(msg, 'nonce') },

    '$auth.nonce'  : (msg) => { return get_from_auth(msg, 'nonce') },
    '$auth.resp'   : (msg) => { return get_from_auth(msg, 'response') },
    '$auth.opaque' : (msg) => { return get_from_auth(msg, 'opaque') },
    '$auth.alg'    : (msg) => { return get_from_auth(msg, 'algorithm') },
    '$auth.qop'    : (msg) => { return get_from_auth(msg, 'qop') },
    '$auth.nc'     : (msg) => { return get_from_auth(msg, 'nc') },

    $ai: (msg) => { return get(msg, ['headers', 'p-asserted-identity', 'uri'], parse_pai) },

    $di:  (msg) => { return get(msg, ['headers', 'diversion', 'uri'], parse_diversion) },
    $dip: (msg) => { return get(msg, ['headers', 'diversion', 'params', 'privacy'], parse_diversion) },
    $dir: (msg) => { return get(msg, ['headers', 'diversion', 'params', 'reason'], parse_diversion) },

    $re: (msg) => { return get(msg, ['headers', 'remote-party-id', 'uri'], parse_rpi) },

    $rt: (msg) => { return get(msg, ['headers', 'refer-to', 'uri']) },

    $cs: (msg) => { return get(msg, ['headers', 'cseq', 'seq']) },

    $rb: (msg) => { return msg.content != "" ? msg.content : undefined },

    $ua: (msg) => { return msg.headers['user-agent'] },

    $ci: (msg) => { return msg.headers['call-id'] },

    $cl: (msg) => { return msg.headers['content-length'] },

    $cT: (msg) => { return msg.headers['content-type'] },



    $rm: (msg) => { return get(msg, ['headers', 'cseq', 'method']) },
    $ru: (msg) => { return msg.uri },
    $rv: (msg) => { return "SIP/" + msg.version },

    $rz: (msg) => { return get(msg, ["request_uri", "schema"], parse_request_uri) },
    $rU: (msg) => { return get(msg, ["request_uri", "user"], parse_request_uri) },
    $rd: (msg) => { return get(msg, ["request_uri", "host"], parse_request_uri) },
    $rp: (msg) => { return get(msg, ["request_uri", "port"], parse_request_uri) },

    $rs: (msg) => { return msg.status },
    $rr: (msg) => { return msg.reason },

    '$msg.is_request': (msg) => { return msg.uri ? 1 : 0 },
    '$msg.type': (msg) => { return msg.uri ? 'request' : 'reply' },
    $mt: (msg) => { return msg.uri ? 1 : 2},
}

module.exports = {
    parse: (msg_payload) => {
        var msg = sip.parse(msg_payload)

        msg.$ml = msg_payload.length

        var o = new Proxy(msg, {
            get: function (target, key, receiver) {
                if (target.hasOwnProperty(key)){
                    return Reflect.get(target, key, receiver);
                }

                if(base_pseudovar_accessors[key]) {
                    return base_pseudovar_accessors[key](target)
                }

                var key = key.toString()

                var match = undefined

                if (key.startsWith("hdr_")) {
                    var name = key.slice(4).replaceAll("_", "-")
                    if(compact_headers[name]) {
                        name = compact_headers[name]
                    }

                    target[key] = get_header(name, target) 
                    return target[key]
                }

                var re_hdr = /^\$hdr\(([^\)]+)\)$/
                match = key.match(re_hdr)
                if(match) {
                    var name = match[1]
                    if(compact_headers[name]) {
                        name = compact_headers[name]
                    }

                    target[key] = get_header(name, target) 
                    return target[key]
                }

                var re_hdr_with_index = /^\$\(hdr\(([^\)]+)\)\[(-1|[0-9]+|\*)\]\)$/
                match = key.match(re_hdr_with_index)
                if(match) {
                    var name = match[1]
                    if(compact_headers[name]) {
                        name = compact_headers[name]
                    }

                    //var index = parseInt(match[2])
                    var index = match[2]
                    target[key] = get_header_by_index(name, index, target) 
                    return target[key]
                }

                var re_hdrcnt = /^\$\(hdrcnt\(([^\)]+)\)\)$/
                match = key.match(re_hdrcnt)
                if(match) {
                    var name = match[1].toLowerCase()
                    if(compact_headers[name]) {
                        name = compact_headers[name]
                    }

                    var items = target.headers[name]
                    if(!items) return 0
                    return items.length
                }

                return undefined
            },
        })

        return o
    },

    get,
    parse_diversion,
}

