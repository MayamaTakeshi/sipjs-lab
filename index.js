const sip = require('sip')
const digest = require('sip/digest')
const util = require('util')

const events = require('events')
const eventEmitter = new events.EventEmitter()

const deepmerge = require('deepmerge')

function rstring() { return Math.floor(Math.random()*1e6).toString() }

const endpoints = {}
const calls = {}

var next_endpoint_id = 0
var next_call_id = 0

const endpoint_create = (opts) => {
    if(!opts.address) { throw("opts.address is required") }
    if(!opts.port) { throw("opts.port is required") }

    const stack = sip.create(opts, (req) => {
        var event = {
            source: 'sip_endpoint',
            event: 'request',
            stack: stack,
            req: req,
        }
        eventEmitter.emit('event', event)
    })

    const new_id = next_endpoint_id
    endpoints[new_id] = {
        stack,
        opts,
        id: new_id,
    }
    next_endpoint_id++
    
    return new_id
}

const endpoint_destroy = (id) => {
    if(!endpoints[id]) {
        throw(`Invalid endpoint id=${id}`)
    }
    endpoints[id].stack.destroy()
    delete endpoints[id]
}

const send_request = (endpoint, req, event_extra_params) => {
    /*
    var via = [ { 
        version: '2.0',
        protocol: 'UDP',
        host: endpoint.opts.address,
        port: endpoint.opts.port,
        params: { branch: rstring() },
    }]
    req.headers.via = via
    */

    var contact = [ { 
        uri: `sip:sipjs@${endpoint.opts.address}:${endpoint.opts.port}`,
    } ]

    req.headers.contact = contact
    //console.log(sip.stringify(req))
    //console.log(req)

    endpoint.stack.send(req, function(res) {
        var event = {
            source: 'sip_endpoint',
            endpoint_id: endpoint.id,
            event: 'response',
            res: res,
        }
        event = deepmerge(event, event_extra_params)
        eventEmitter.emit("event", event)
    })
}

const call_create = (endpoint_id, params, msg_template) => {
    if(!endpoints[endpoint_id]) {
        throw(`Invalid endpoint_id=${endpoint_id}`)
    }
    var endpoint = endpoints[endpoint_id]

    var invite;
    if(msg_template) {
        invite = sip.parse(msg_template)
        invite = deepmerge(invite, params)
    } else {
        if(!params.uri) { throw("params missing uri") }
        if(!params.headers.from) { throw("params missing headers['from']") }
        if(!params.headers.to) { throw("params missing headers['to']") }

        invite = {...params}
        invite.method = 'INVITE'
    }

    var seq = 1
    if(invite.headers.cseq) {
        seq = invite.headers.cseq
    } else {
        invite.headers.cseq = { method: 'INVITE', seq }
    }

    var new_id = next_call_id
    next_call_id++

    invite.headers['call-id'] = `${new_id}@${rstring()}`

    calls[new_id] = {
        id: new_id,
        endpoint,
        state: 'offering',
    }

    send_request(endpoint, invite, { call_id: new_id })

    return new_id
}

module.exports = {
    endpoint: {
        create: endpoint_create,
        destroy: endpoint_destroy,
    }, 

    call: {
        create: call_create,
    },

    event_source: eventEmitter,
}
