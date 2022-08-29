const sip = require('sip')
const digest = require('sip/digest')
const util = require('util')
const uuid_v4 = require('uuid').v4

const assert = require('assert')

const events = require('events')
const eventEmitter = new events.EventEmitter()

const deepmerge = require('deepmerge')

function rstring() { return Math.floor(Math.random()*1e6).toString() }

const endpoints = {}
const dialogs = {}
const dialog_map = {}

var next_endpoint_id = 0
var next_dialog_id = 0

const endpoint_create = (opts) => {
    if(!opts.address) { throw("opts.address is required") }
    if(!opts.port) { throw("opts.port is required") }

    const endpoint_id = next_endpoint_id++

    const stack = sip.create(opts, (req) => {
        try {
            var evt = {
                source: 'sip_endpoint',
                endpoint_id,
                req,
            }

            if(req.headers['call-id'] == null) {
                evt.event = 'invalid_message'
                evt.details = `${req.method} without call-id`
                eventEmitter.emit('event', evt)
                return
            }

            if(req.headers['cseq'] == null) {
                evt.event = 'invalid_message'
                evt.details = `${req.method} without cseq`
                eventEmitter.emit('event', evt)
                return
            }

            if(req.headers['cseq'].seq == null) {
                evt.event = 'invalid_message'
                evt.details = `${req.method} without cseq seq`
                eventEmitter.emit('event', evt)
                return
            }
            const seq = req.headers['cseq'].seq

            // We might trap other requests without To, From, Via or Contact headers.

            const call_id = req.headers['call-id']
            const id = [call_id, endpoint_id].join('@')

            console.log(`dialog_map=${JSON.stringify(dialog_map)} id=${id} res=${dialog_map[id]}`)
            if(dialog_map[id] != null) {
                evt.event = 'in_dialog_request'
                evt.dialog_id = dialog_map[id]
                const dialog = dialogs[evt.dialog_id]
                if(req.headers.contact && req.headers.contact[0]) {
                    dialog.contact = req.headers.contact[0]
                }
                if(req.headers['record-route']) {
                    dialog.route = req.headers['record-route']
                }
                if(req.method != 'ACK' && req.method != 'CANCEL') {
                    dialog.seq = req.headers.cseq.seq
                }
            } else {
                if(req.method == 'INVITE' || req.method == 'SUBSCRIBE') {
                    if(req.headers.to != null && req.headers.to.params != null && req.headers.to.params.tag != null) {
                        //console.log(`dialogs=${JSON.stringify(dialogs)}`)
                        evt.event = `in_dialog_request_for_unknown_dialog ${id}`
                        eventEmitter.emit('event', evt)
                        return
                    }
                    evt.event = 'dialog_offer'
                    const new_dialog_id = next_dialog_id++
                    evt.dialog_id = new_dialog_id

                    dialogs[new_dialog_id] = {
                        id: new_dialog_id,
                        endpoint_id: endpoint_id,
                        offer: req,
                        direction: 'incoming',
                        state: 'offering', 
                        seq,
                        from: req.headers.to,
                        to: req.headers.from,
                        contact: req.headers.contact ? req.headers.contact[0] : null,
                        route: req.headers['record-route'],
                    }
                    dialog_map[id] = new_dialog_id
                } else {
                    // REGISTER, OPTIONS, PUBLISH, MESSAGE (when out-of-dialog) etc
                    evt.event = 'out_of_dialog_request'
                }
            }
            eventEmitter.emit('event', evt)
        } catch(e) {
            var evt = {
                source: 'sip_endpoint',
                endpoint_id,
                event: 'error',
                origin: 'endpoint/create/sip.create/callback',
                details: e,
                stack: e.stack,
            }
            eventEmitter.emit('event', evt)
        }
    })

    endpoints[endpoint_id] = {
        stack,
        opts,
        id: endpoint_id,
    }
    
    return endpoint_id
}

const endpoint_destroy = (id) => {
    if(endpoints[id] == null) {
        throw(`Invalid endpoint id=${id}`)
    }
    endpoints[id].stack.destroy()
    delete endpoints[id]
}

const gen_req = (params, template, initial_request, new_call_id) => {
    var req = {}
    if(template != null) {
        req = sip.parse(template)
        assert(req)
        delete req.headers.via
        delete req.headers.route
        delete req.headers.contact
    }

    if(params != null) {
        req = {...req, ...params}
    }

    if(req.method == null) { throw("could not resolve method") }
    if(req.uri == null) { throw("could not resolve uri") }
    if(req.headers == null) { throw("could not resolve headers") }
    if(req.headers.from == null) { throw("could not resolve headers['from']") }
    if(req.headers.to == null) { throw("could not resolve headers['to']") }

    if(initial_request) {
        if(req.headers.to.params) {
            delete req.headers.to.params.tag
        }
    } else {
        if(req.headers.from.params.tag == null) {
            req.headers.from.params.tag = rstring()
        }
    }

    if(req.headers.from.params == null) {
        req.headers.from.params = {}
    }

    var seq = 1
    if(req.headers.cseq != null) {
        seq = req.headers.cseq.seq
    } else {
        req.headers.cseq = { method: req.method, seq }
    }

    if(new_call_id) {
        req.headers['call-id'] = uuid_v4()
    }

    return req
}

const endpoint_send_request = (endpoint, req, dialog) => {
    req.headers.contact = [ { uri: `sip:sipjs@${endpoint.opts.address}:${endpoint.opts.port}` } ]

    //console.log(sip.stringify(req))
    //console.log(req)
    console.log("endpoint_send_request sending:", JSON.stringify(req))

    endpoint.stack.send(req, function(res) {
        try {
            var evt = {
                source: 'sip_endpoint',
                endpoint_id: endpoint.id,
                event: 'response',
                res: res,
            }

            if(dialog) {
                evt.dialog_id = dialog.id

                dialog.contact = res.headers.contact ? res.headers.contact[0] : null

                if(res.headers['record-route'] != null) {
                    dialog.route = res.headers['record-route']
                }

                if(dialog.direction == 'outgoing') {
                    dialog.from = res.headers.from
                    dialog.to = res.headers.to
                }
            }

            eventEmitter.emit("event", evt)
        } catch(e) {
            var evt = {
                source: 'sip_endpoint',
                endpoint_id,
                event: 'error',
                origin: 'endpoint/stack.send/callback',
                details: e,
                stack: e.stack,
            }
            eventEmitter.emit('event', evt)
        }
    })
}

const endpoint_send_non_dialog_request = (endpoint_id, params, template) => {
    if(endpoints[endpoint_id] == null) {
        throw(`Invalid endpoint_id=${endpoint_id}`)
    }
    const endpoint = endpoints[endpoint_id]

    var req = gen_req(params, template, true, true)

    endpoint_send_request(endpoint, req)
}

const endpoint_send_reply = (endpoint, req, status, reason, params, template, dialog) => {
    if(status == null || reason == null) {
        throw(`status and reason are required`)
    }

    var res = sip.makeResponse(req, status, reason)
    console.log(`sip.makeResponse res=${JSON.stringify(res)}`)

    if(template != null) {
        var temp = sip.parse(template)
        delete temp.headers.via
        delete temp.headers['record-route']
        delete temp.headers.contact
        delete temp.headers.from
        delete temp.headers.to
        delete temp.headers['call-id']
        res = deepmerge(res, temp)
    }

    if(params != null) {
        res = deepmerge(res, params)
    }

    if(status != 100) {
        if(!res.headers.to.params.tag) {
            res.headers.to.params.tag = rstring()
        }
    }

    if(dialog && dialog.direction == 'incoming') {
        dialog.from = res.headers.to
        console.log(`dialog_send reply: dialog.from=${JSON.stringify(dialog.from)}`)
    }

    res.headers.contact = [ { uri: `sip:sipjs@${endpoint.opts.address}:${endpoint.opts.port}` } ]

    console.log(JSON.stringify(res))
    endpoint.stack.send(res)
}


const dialog_create = (endpoint_id, params, template) => {
    if(endpoints[endpoint_id] == null) {
        throw(`Invalid endpoint_id=${endpoint_id}`)
    }
    const endpoint = endpoints[endpoint_id]

    var req = gen_req(params, template, true, true)

    assert(req.headers['call-id'])
    const id = [req.headers['call-id'], endpoint_id].join('@')

    const new_dialog_id = next_dialog_id++

    const dialog = {
        id: new_dialog_id,
        endpoint_id,
        offer: req,
        direction: 'outgoing',
        state: 'offering',
        seq: req.headers.cseq.seq,
        from: req.headers.from,
        to: req.headers.to,
    }

    dialogs[new_dialog_id] = dialog

    dialog_map[id] = new_dialog_id

    endpoint_send_request(endpoint, req, dialog)

    return new_dialog_id
}

const dialog_send_reply = (dialog_id, req, status, reason, params, template) => {
    if(dialogs[dialog_id] == null) {
        throw(`Invalid dialog_id=${dialog_id}`)
    }
    const dialog = dialogs[dialog_id]

    const endpoint = endpoints[dialog.endpoint_id]

    endpoint_send_reply(endpoint, req, status, reason, params, template, dialog)
}

const dialog_send_request = (dialog_id, params, template) => {
    if(dialogs[dialog_id] == null) {
        throw(`Invalid dialog_id=${dialog_id}`)
    }
    const dialog = dialogs[dialog_id]

    if(params == null || params.method == null) {
        throw(`Missing params.method`)
    }

    const endpoint = endpoints[dialog.endpoint_id]

    var req = {}

    if(template != null) {
        var temp = sip.parse(template)
        req = deepmerge(req, temp)
    } else {
        req = deepmerge(req, params)
    }

    //console.log(`dialog_send_request for dialog_id=${dialog_id}`, dialog)

    var headers = {
        to: dialog.to,
        from: dialog.from,
        'call-id': dialog.offer.headers['call-id'],
    }

    req.headers = deepmerge(req.headers, headers)

    if(req.method == 'CANCEL') {
        if(dialog.direction == 'incoming') {
            throw(`Cannot send CANCEL to an incoming call`)
        }
        req.uri = dialog.offer.uri
    } else if(req.method == 'ACK') {
        req.uri = dialog.contact.uri
    } else {
        dialog.seq++
        req.uri = dialog.contact.uri
    }

    req.headers.cseq = { method: params.method, seq: dialog.seq }

    console.log("dialog_send_request:", JSON.stringify(dialog))
    req.headers.route = dialog.route

    endpoint_send_request(endpoint, req, dialog)
}

module.exports = {
    endpoint: {
        create: endpoint_create,
        send_non_dialog_request: endpoint_send_non_dialog_request,
        send_reply: endpoint_send_reply,
        destroy: endpoint_destroy,
    }, 

    dialog: {
        create: dialog_create,
        send_reply: dialog_send_reply,
        send_request: dialog_send_request,
    },

    event_source: eventEmitter,
}
