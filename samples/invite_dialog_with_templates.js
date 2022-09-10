/* this test creates two sip endpoints, makes a call between them, reinvites from both sides, sends INFO from both sides and terminates the call 
   it generates basic data for INVITE and '200 OK' for INVITE from templates
*/

const sipjs = require('../index.js')
const {endpoint, dialog, sip_msg} = require('../index.js')

const Zeq = require('@mayama/zeq')
const m = require('data-matching')
const util = require('util')

const z = new Zeq()

z.trap_events(sipjs.event_source, 'event', (evt) => {
    var e = evt.args[0]
    return e
})

const invite_template = `INVITE sip:780@192.168.200.6:5060 SIP/2.0
Via: SIP/2.0/UDP 192.168.200.68:5060;branch=z9hG4bK6810pr20205h2akqe381.1
Contact: "Anonymous"<sip:anonymous@192.168.200.68:5060;transport=udp>
Supported: 100rel
From: "Anonymous"<sip:anonymous@anonymous.invalid>;tag=SDfd9sa01-000000ba00023280
To: <sip:780@192.168.200.6:5060>
Call-ID: SDfd9sa01-6f93292521b83a0980647f34451c5afd-06ahc21
CSeq: 2 INVITE
P-Preferred-Identity: "rdoe"<sip:42343@192.168.200.68:5060>
Privacy: id
Content-Length: 180
Content-Type: application/sdp
Max-Forwards: 70

v=0
o=IWF 5 5 IN IP4 192.168.200.5
s=H323 Call
c=IN IP4 192.168.200.65
t=0 0
m=audio 5010 RTP/AVP 0
a=rtpmap:0 PCMU/8000/1
m=video 5014 RTP/AVP 31
a=rtpmap:31 H261/9000/1`.replace(/\n/g, "\r\n")


const answer_template =`SIP/2.0 200 OK
Via: SIP/2.0/TCP ss1.atlanta.example.com:5060;branch=z9hG4bK2d4790.1;received=192.0.2.111
Via: SIP/2.0/TCP client.atlanta.example.com:5060;branch=z9hG4bK74bf9;received=192.0.2.101
From: June <sip:june@atlanta.example.com>;tag=9fxced76sl
To: Adam <sip:adam@biloxi.example.com>;tag=314159
Call-ID: 3848276298220188511@atlanta.example.com
CSeq: 2 INVITE
Contact: <sip:adam@client.biloxi.example.com;transport=tcp>
Content-Type: application/sdp
Content-Length: 147

v=0
o=adam 2890844527 2890844527 IN IP4 client.biloxi.example.com
s=-
c=IN IP4 192.0.2.201
t=0 0
m=audio 3456 RTP/AVP 0
a=rtpmap:0 PCMU/8000`.replace(/\n/g, "\r\n")


var logger = { 
    send: function(message, address) { debugger; util.debug("send\n" + util.inspect(message, false, null)); },
    recv: function(message, address) { debugger; util.debug("recv\n" + util.inspect(message, false, null)); },
    error: function(e) { util.debug(e.stack); }
}

async function test() {
    const domain = 'test1.com'
    const address = '127.0.0.1'
    const ada_port = 7070
    const bob_port = 7072
    const ada = endpoint.create({address, port: ada_port, publicAddress: address, logger: logger })
    const bob = endpoint.create({address, port: bob_port, publicAddress: address, logger: logger })

    const ada_call_id = dialog.create(
        ada,
        {
            method: 'INVITE',
            uri: `sip:bob@${address}:${bob_port}`,
            headers: {
                from: {uri: `sip:ada@${domain}`},
                to: {uri: `sip:bob@${address}:${bob_port}`},
            },
        },
        invite_template
    )

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: bob,
            req: m.collect('req', sip_msg({
                $rm: 'INVITE',
                $rU: 'bob',
                $fU: 'ada',
                $fd: domain,
            })),
            event: 'dialog_offer',
            dialog_id: m.collect('bob_call_id'),
        },
    ], 1000)

    bob_call_id = z.store['bob_call_id']

    dialog.send_reply(
        bob_call_id, 
        z.store.req,
        {
            status: 200,
            reason: 'OK',
        },
        answer_template
    )

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: ada,
            event: 'response',
            res: m.collect('res', {
                $rm: 'INVITE',
                $rs: 200,
                $rr: 'OK',
                $fU: 'ada',
                $fd: domain,
            }),
            res: m.collect('res'),
            dialog_id: ada_call_id,
        },
    ], 1000)

    console.log(JSON.stringify(z.store.res))
    //process.exit(1)

    dialog.send_request(ada_call_id, {
        method: 'ACK',
    })
    
    await z.wait([
        {
            source: 'sip_endpoint',                                                                          
            endpoint_id: bob,                                                                                  
            event: 'in_dialog_request',
            dialog_id: bob_call_id,
            req: sip_msg({
                $rm: 'ACK',
            })
        },
    ], 1000)


    // now do a RE-INVITE from ada's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null

    dialog.send_request(
        ada_call_id,
        {
            method: 'INVITE',
            headers: {
                'content-type': 'application/sdp',
            },
        },
        invite_template
    )

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: bob,
            req: m.collect('req'),
            event: 'in_dialog_request',
            dialog_id: bob_call_id
        },
    ], 1000)
 
    dialog.send_reply(
        bob_call_id,
        z.store.req,
        {
            status: 200,
            reason: 'OK',
        },
        answer_template
    )

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: ada,
            event: 'response',
            res: m.collect('res', sip_msg({
                $rm: 'INVITE',
                $rs: 200,
                $rr: 'OK',
                $fU: 'ada',
                $fd: domain,
            })),
            dialog_id: ada_call_id,
        },
    ], 1000)

    dialog.send_request(ada_call_id, {
        method: 'ACK',
    })

    await z.wait([
        {
            source: 'sip_endpoint',                                                                          
            endpoint_id: bob,                                                                                  
            event: 'in_dialog_request',
            dialog_id: bob_call_id,
            req: sip_msg({
                $rm: 'ACK',
            })
        },
    ], 1000)


    // now do a RE-INVITE from bob's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null

    dialog.send_request(
        bob_call_id,
        {
            method: 'INVITE',
            headers: {
                'content-type': 'application/sdp',
            },
        },
        invite_template
    )

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: ada,
            req: m.collect('req'),
            event: 'in_dialog_request',
            dialog_id: ada_call_id
        },
    ], 1000)
 
    dialog.send_reply(
        ada_call_id,
        z.store.req,
        {
            status: 200,
            reason: 'OK',
        },
        answer_template
    )

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: bob,
            event: 'response',
            res: m.collect('res', sip_msg({
                $rm: 'INVITE',
                $rs: 200,
                $rr: 'OK',
                $fU: 'bob',
                $tU: 'ada',
            })),
            dialog_id: bob_call_id,
        },
    ], 1000)

    dialog.send_request(bob_call_id, {
        method: 'ACK',
    })

    await z.wait([
        {
            source: 'sip_endpoint',                                                                          
            endpoint_id: ada,                                                                                  
            event: 'in_dialog_request',
            dialog_id: ada_call_id,
            req: sip_msg({
                $rm: 'ACK',
            }),
        },
    ], 1000)


    // now send INFO from ada's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null

    dialog.send_request(ada_call_id, {
        method: 'INFO',
        headers: {
            Subject: 'Money Transfer By Wire',
            'Content-Type': 'application/mgcp',
        },
        content: "NTFY 123456 a.g.bell@bell-tel.com MGCP  1.0\r\nO: D/8, D/7, D/2, D/6, D/#, D/L",
    })

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: bob,
            req: m.collect('req', sip_msg({
                $rm: 'INFO',
                $rb: "NTFY 123456 a.g.bell@bell-tel.com MGCP  1.0\r\nO: D/8, D/7, D/2, D/6, D/#, D/L",
            })),
            event: 'in_dialog_request',
            dialog_id: bob_call_id,
        },
    ], 1000)
 
    dialog.send_reply(
        bob_call_id,
        z.store.req,
        {
            status: 200,
            reason: 'OK',
        }
    )

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: ada,
            event: 'response',
            res: m.collect('res', sip_msg({
                $rm: 'INFO',
                $rs: 200,
                $rr: 'OK',
            })),
            dialog_id: ada_call_id,
        },
    ], 1000)


    // now send INFO from bob's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null


    dialog.send_request(bob_call_id, {
        method: 'INFO',
        headers: {
            Subject: 'Your wheater report is ready',
            'Content-Type': 'text/plain',
        },
        content: "Cloudy, with a chance of rain",
    })

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: ada,
            req: m.collect('req', sip_msg({
                $rm: 'INFO',
                $rb: "Cloudy, with a chance of rain",
            })),
            event: 'in_dialog_request',
            dialog_id: ada_call_id,
        },
    ], 1000)

    dialog.send_reply(
        ada_call_id,
        z.store.req,
        {
            status: 200,
            reason: 'OK',
        }
    )

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: bob,
            event: 'response',
            res: m.collect('res', sip_msg({
                $rm: 'INFO',
                $rs: 200,
                $rr: 'OK',
            })),
            dialog_id: bob_call_id,
        },
    ], 1000)



    // Now disconnect from ada's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null


    dialog.send_request(ada_call_id, {
        method: 'BYE',
    })

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: bob,
            event: 'in_dialog_request',
            dialog_id: bob_call_id,
            req: m.collect('req', sip_msg({
                $rm: 'BYE',
            })),
        },
    ], 1000)

    dialog.send_reply(
        bob_call_id,
        z.store.req,
        {
            status: 200,
            reason: 'OK',
        }
    )

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: ada,
            event: 'response',
            res: m.collect('res', sip_msg({
                $rm: 'BYE',
                $rs: 200,
                $rr: 'OK',
                $fU: 'ada',
                $fd: domain,
            })),
            dialog_id: ada_call_id,
        },
    ], 1000)

    await z.sleep(100) // wait for any unexpected events

    dialog.destroy(ada_call_id)
    dialog.destroy(bob_call_id)

    sipjs.endpoint.destroy(ada)
    sipjs.endpoint.destroy(bob)

    console.log("success")
}


test()
.catch((e) => {
    console.error(e)
    process.exit(1)
})
