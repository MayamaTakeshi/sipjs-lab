const sip = require('sip')
const digest = require('sip/digest')
const util = require('util')
const uuid_v4 = require('uuid').v4

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
        var evt = {
            source: 'sip_endpoint',
            endpoint_id,
            req,
            msg: sip.stringify(req),
        }

        if(!req.headers['call-id']) {
            evt.event = 'invalid_message'
            evt.details = `${req.method} without call-id`
            eventEmitter.emit('event', evt)
            return
        }

        if(!req.headers['cseq']) {
            evt.event = 'invalid_message'
            evt.details = `${req.method} without cseq`
            eventEmitter.emit('event', evt)
            return
        }

        if(!req.headers['cseq'].seq) {
            evt.event = 'invalid_message'
            evt.details = `${req.method} without cseq seq`
            eventEmitter.emit('event', evt)
            return
        }
        const seq = req.headers['cseq'].seq

        // We might trap other requests without To, From, Via or Contact headers.

        const call_id = req.headers['call-id']
        const id = [call_id, endpoint_id].join('@')

        if(dialog_map[id]) {
            evt.event = 'in_dialog_request'
            evt.dialog_id = dialog_map[id]
        } else {
            if(req.method == 'INVITE' || req.method == 'SUBSCRIBE') {
                if(req.headers.to && req.headers.to.params && req.headers.to.params.tag) {
                    evt.event = 'request_for_unknown_dialog'
                    eventEmitter.emit('event', evt)
                    return
                }
                evt.event = 'dialog_offer'
                const new_dialog_id = next_dialog_id++
                evt.dialog_id = new_dialog_id

                dialogs[new_dialog_id] = {
                    id: new_dialog_id,
                    offer: req,
                    endpoint_id: endpoint_id,
                    directon: 'incoming',
                    state: 'offering', 
                    contact: req.headers.contact ? req.headers.contact[0] : null,
                    route: req.headers['record-route'],
                    seq,
                }
                dialog_map[id] = new_dialog_id
            } else {
                // REGISTER, OPTIONS, PUBLISH, MESSAGE (when out-of-dialog) etc
                evt.event = 'out_of_dialog_request'
            }
        }
        eventEmitter.emit('event', evt)
    })

    endpoints[endpoint_id] = {
        stack,
        opts,
        id: endpoint_id,
    }
    
    return endpoint_id
}

const endpoint_destroy = (id) => {
    if(!endpoints[id]) {
        throw(`Invalid endpoint id=${id}`)
    }
    endpoints[id].stack.destroy()
    delete endpoints[id]
}

const send_request = (endpoint, req, dialog) => {
    req.headers.contact = [ { uri: `sip:sipjs@${endpoint.opts.address}:${endpoint.opts.port}` } ]

    //console.log(sip.stringify(req))
    //console.log(req)
    console.log("send_request sending:", JSON.stringify(req))

    endpoint.stack.send(req, function(res) {
        var evt = {
            source: 'sip_endpoint',
            endpoint_id: endpoint.id,
            event: 'response',
            res: res,
            msg: sip.stringify(res),
        }
        if(dialog) {
            console.log("dialog is set ", dialog.id)
            evt.dialog_id = dialog.id

            dialog.contact = res.headers.contact ? res.headers.contact[0] : null,
            dialog.route = res.headers['record-route']
            if(dialog.direction == 'outgoing') {
                dialog.from = res.headers.from
                dialog.to = res.headers.to
            }
        } else {
            console.log("dialog is not set")
        }

        eventEmitter.emit("event", evt)
    })
}

const dialog_create = (endpoint_id, params, template) => {
    if(!endpoints[endpoint_id]) {
        throw(`Invalid endpoint_id=${endpoint_id}`)
    }
    const endpoint = endpoints[endpoint_id]

    var req 
    if(template) {
        req = sip.parse(template)
        req = deepmerge(req, params)
    } else {
        if(!params.method) { throw("params missing method") }
        if(!params.uri) { throw("params missing uri") }
        if(!params.headers) { throw("params missing headers") }
        if(!params.headers.from) { throw("params missing headers['from']") }
        if(!params.headers.to) { throw("params missing headers['to']") }

        if(params.headers.to && params.headers.to.params && params.headers.params.tag) { throw("params should not contain headers['to'] with tag") }

        req = {...params}
    }

    if(!params.headers.from.params) {
        params.headers.from.params = {}
    }

    if(!params.headers.from.params.tag) {
        params.headers.from.params.tag = rstring()
    }

    const seq = 1
    if(req.headers.cseq) {
        seq = req.headers.cseq
    } else {
        req.headers.cseq = { method: req.method, seq }
    }

    const new_dialog_id = next_dialog_id++

    const call_id = uuid_v4()
    req.headers['call-id'] = call_id

    const id = [call_id, endpoint_id].join('@')

    const dialog = {
        id: new_dialog_id,
        endpoint_id,
        offer: req,
        direction: 'outgoing',
        state: 'offering',
        from: params.headers.from,
        to: params.headers.to,
        seq,
    }

    dialogs[new_dialog_id] = dialog

    dialog_map[id] = new_dialog_id

    send_request(endpoint, req, dialog)

    return new_dialog_id
}

const dialog_send_reply = (dialog_id, req, status, reason, params, template) => {
    if(!dialogs[dialog_id]) {
        throw(`Invalid dialog_id=${dialog_id}`)
    }
    const dialog = dialogs[dialog_id]

    if(!status || !reason) {
        throw(`status and reason are required`)
    }

    const endpoint = endpoints[dialog.endpoint_id]

    var res = sip.makeResponse(req, status, reason)

    if(template) {
        var temp = sip.parse(template)
        res = deepmerge(res, temp)
    }

    if(params) {
        res = deepmerge(res, params)
    }

    if(status != 100) {
        if(!res.headers.to.params.tag) {
            res.headers.to.params.tag = rstring()
        }
    }

    if(dialog.direction == 'incoming') {
        dialog.from = res.headers.to
        dialog.to = res.headers.from
    }

    res.headers.contact = [ { uri: `sip:sipjs@${endpoint.opts.address}:${endpoint.opts.port}` } ]

    endpoint.stack.send(res)
}

const dialog_send_request = (dialog_id, params, template) => {
    if(!dialogs[dialog_id]) {
        throw(`Invalid dialog_id=${dialog_id}`)
    }
    const dialog = dialogs[dialog_id]

    if(!params || !params.method) {
        throw(`Missing params.method`)
    }

    const endpoint = endpoints[dialog.endpoint_id]

    var req = {}

    if(template) {
        var temp = sip.parse(template)
        req = deepmerge(req, temp)
    } else {
        req = deepmerge(req, params)
    }

    var headers = {
        to: dialog.to,
        from: dialog.from,
        'call-id': dialog.offer.headers['call-id'],
    }

    req.headers = deepmerge(req.headers, headers)

    if(req.method == 'ACK') {
        req.uri = dialog.offer.uri
    } else {
        dialog.seq++
        req.uri = dialog.contact.uri
    }

    req.headers.cseq = { method: params.method, seq: dialog.seq }

    console.log("dialog:", JSON.stringify(dialog))
    req.headers.route = dialog.route

    send_request(endpoint, req, dialog)
}

module.exports = {
    endpoint: {
        create: endpoint_create,
        destroy: endpoint_destroy,
    }, 

    dialog: {
        create: dialog_create,
        send_reply: dialog_send_reply,
        send_request: dialog_send_request,
    },

    event_source: eventEmitter,
}
