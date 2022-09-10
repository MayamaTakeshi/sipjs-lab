# sipjs-lab

## Overview

A simple nodejs module based on https://github.com/kirm/sip.js to help writing SIP functional tests.

## Installation

Do it as usual
```
npm install sipjs-lab
```

## Usage

Basically, [sip.js](https://github.com/kirm/sip.js) works at the SIP transaction level: it doesn't have the notion of dialogs so when using it you must control them.
So sipjs-lab adds a SIP dialog control layer so that we have the following functions:

To control sip endpoints:
```
    endpoint: {
        create,
        send_non_dialog_request,
        send_reply,
        destroy,
    }, 
```

To control dialogs:
```
    dialog: {
        create,
        send_reply,
        send_request,
        destroy,
    },
```

The tests are written using [@mayama/zeq](https://github.com/MayamaTakeshi/zeq)

By cloning this repo, try:

```
npm install
node samples/simple.js
```
