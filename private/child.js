var fs = require('/usr/lib/node_modules/fs-ext/fs-ext.js');
var bone = require('bonescript');
var noble = require('noble');
var SensorTag = require('sensortag');

var mySensorTag         = null;
var lastRSSI            = null;

/////////////////////////////////////////////////////////////////////////////////

var StateGeneratedEvent = null;
var StateGeneratedEventArg = null;

function clearStateGeneratedEvent() {
    StateGeneratedEvent = null;
    StateGeneratedEventArg = null;
}

function stateFunction_idle_entry( arg ) {
    console.log('stateFunction_idle_entry... arg=' + arg);
}
function stateFunction_idle_exit( arg ) {
    console.log('stateFunction_idle_exit... arg=' + arg);
}

function stateFunction_connect_entry( arg ) {
    console.log('stateFunction_connect_entry... arg=' + arg);
    if (typeof arg === "undefined" || arg === 'null') {
        //error! cannot enter this state without giving SensorTag UUID to connect to.
        StateGeneratedEvent = 'error';
        StateGeneratedEventArg = null;
        return;
    }

    // success of connection will cause transition to poll_rssi
    DiscoverSensorTagAndConnect( arg );
}
function stateFunction_connect_exit( arg ) {
    console.log('stateFunction_connect_exit... arg=' + arg);
}

function stateFunction_poll_rssi_entry( arg ) {
    console.log('stateFunction_poll_rssi_entry... arg=' + arg + ', mySensorTag=' + mySensorTag);
    mySensorTag._peripheral.updateRssi(function (err, rssi) {
        console.log('updateRssi: err = ' + err + ', rssi = ' + rssi);
    });
    // for now, poll again
    StateGeneratedEvent = 'poll';
    StateGeneratedEventArg = null;
}
function stateFunction_poll_rssi_exit( arg ) {
    console.log('stateFunction_poll_rssi_exit... arg=' + arg);
}

function stateFunction_disconnect_entry( arg ) {
    console.log('stateFunction_disconnect_entry... arg=' + arg);
}
function stateFunction_disconnect_exit( arg ) {
    console.log('stateFunction_disconnect_exit... arg=' + arg);
}

function stateFunction_get_temperature_entry( arg ) {
    console.log('stateFunction_get_temperature_entry... arg=' + arg);
}
function stateFunction_get_temperature_exit( arg ) {
    console.log('stateFunction_get_temperature_exit... arg=' + arg);
}

states = [
    {
        'initial': true,
        'name': 'idle',
        'events': {
            'start':'connect',
        },
        'state_functions' : {
            'entry': stateFunction_idle_entry,
            'exit': stateFunction_idle_exit
        }
    },
    {
        'name':'connect',
        'events':{
            'error': 'idle',
            'connect_success': 'poll_rssi'
        },
        'state_functions' : {
            'entry': stateFunction_connect_entry,
            'exit': stateFunction_connect_exit
        }
    },
    {
        'name':'poll_rssi',
        'events':{
            'error': 'disconnect',
            'disconnect': 'disconnect',
            'poll': 'poll_rssi',
            'get_temp': 'get_temperature'
        },
        'state_functions' : {
            'entry': stateFunction_poll_rssi_entry,
            'exit': stateFunction_poll_rssi_exit
        }
    },
    {
        'name':'disconnect',
        'events': {
            'error': 'idle',
            'disconnect_success': 'idle'
        },
        'state_functions' : {
            'entry': stateFunction_disconnect_entry,
            'exit': stateFunction_disconnect_exit
        }
    },
    {
        'name':'get_temperature',
        'events': {
            'error': 'poll_rssi',
            'get_success': 'poll_rssi'
        },
        'state_functions' : {
            'entry': stateFunction_get_temperature_entry,
            'exit': stateFunction_get_temperature_exit
        }
    }
];

function StateMachine( statesArray ) {
	this.states = statesArray;
	this.stateNameToIndex = {};
	
    for( var i = 0; i< this.states.length; i++ ) {
		this.stateNameToIndex  [ this.states[i].name ] = i;
		if ( this.states[i].initial ){
			this.currentState = this.states[ i ];
		}
	}

	this.notifyEvent = function( SMEName, clearStateGenerated, arg ) {
        console.log('notifyEvent: ' + SMEName + ', clearStateGenerated: ' + clearStateGenerated + ', arg: ' + arg);

        // each time we are called due to state generated event, we need to be told (i.e., clearStateGenerated=true)
        //   to clear the state generated event variables here, so as to avoid repeated notifying of the
        //   same event over-and-over.  This event variable holder cannot be cleared externally, since
        //   the 'entry' and 'exit' functions for each state may or may not set the variable again.
        if( clearStateGenerated === true ) {
            console.log('notifyEvent: calling clearStateGeneratedEvent()');
            clearStateGeneratedEvent();
        }

		if( this.currentState.events[ SMEName ] ) {
            var nextStateName = this.currentState.events[ SMEName ];

            if( this.currentState.state_functions['exit'] !== 'undefined' ) {
                // call the current state's exit function
                this.currentState.state_functions['exit']( arg );
            }

            // move to next state
			this.currentState = this.states[ this.stateNameToIndex[ nextStateName ] ] ;

            if( this.currentState.state_functions['entry'] !== 'undefined' ) {
                // call the new state's entry function
                this.currentState.state_functions['entry']( arg );
            }
		}
	}

	this.getStatus = function(){
		return this.currentState.name;
	}
}

////////////////////////////////////////////////////////////////////////////////////////

sm = new StateMachine(states);
console.log('sm.getStatus() = ' + sm.getStatus());

/*
sm.notifyEvent('start', false, 'MYTAGUUID');
console.log('sm.getStatus() = ' + sm.getStatus());

sm.notifyEvent('connect_success');
console.log('sm.getStatus() = ' + sm.getStatus());
 
sm.notifyEvent('get_temp');
console.log('sm.getStatus() = ' + sm.getStatus());
 
sm.notifyEvent('get_success')
console.log('sm.getStatus() = ' + sm.getStatus());

sm.notifyEvent('disconnect')
console.log('sm.getStatus() = ' + sm.getStatus());
*/

////////////////////////////////////////////////////////////////////////////////////////

//var discoveryInProgress = false;

process.on('message', function (m) {
    console.log('CHILD got message:', m);
    if (typeof m.hello !== 'undefined' && typeof m.myTag !== 'undefined') {
        if( sm.getStatus() === 'idle' ) {
            sm.notifyEvent('start', false, m.myTag);
        }
        //console.log('bools: ' + (discoveryInProgress === false) + ', ' + (mySensorTag === null));
        //if (discoveryInProgress === false && mySensorTag === null) {
        //    DiscoverSensorTag(m.myTag);
        //}
    } else {
        console.log('CHILD: no sensor tag UUID given by parent');
    }
});

process.send({ foo: 'bar' });

////////////////////////////////////////////////////////////////////////////////////////
function DiscoverSensorTagAndConnect(tagUUID) {
    console.log('DiscoverSensorTagAndConnect(' + tagUUID + ')');
    SensorTag.discover(function (sensorTag) {
        console.log('SensorTag.discover: sensorTag = ' + sensorTag);

        if (sensorTag.uuid.toLowerCase() === tagUUID) {
            console.log('found my sensortag!');

            mySensorTag = sensorTag;

            sensorTag.connect(function () {
                console.log('connected to sensortag!');

                // setup event for next state
                StateGeneratedEvent = 'connect_success';
                StateGeneratedEventArg = null;
            });
        }
    }, tagUUID
    );
};

/*
function DiscoverSensorTag(tagUUID) {
    console.log('DiscoverSensorTag(' + tagUUID + '): setting discoveryInProgress = true');
    discoveryInProgress = true;
    SensorTag.discover(function (sensorTag) {
        console.log('SensorTag.discover: sensorTag = ' + sensorTag);

        // defer this till connected?
        mySensorTag = sensorTag;

        if (sensorTag.uuid.toLowerCase() === tagUUID) {
            console.log('found my sensortag!');

            sensorTag.connect(function () {
                console.log('connected to sensortag!');
*/
                /*
                sensorTag._peripheral.updateRssi(function (err, rssi) {
                    console.log('updateRssi: err = ' + err + ', rssi = ' + rssi);
                });

                sensorTag._peripheral.on('rssiUpdate', function (rssi) {
                    console.log('peripheral on rssiUpdate: rssi = ' + rssi);

                    sensorTag.discoverServicesAndCharacteristics(function () {
                        console.log('discovered characteristics');

                        sensorTag.enableIrTemperature(function () {
                            console.log('enabled temperature in sensortag!');
                            sensorTag.readIrTemperature(function (objectTemperature, ambientTemperature) {
                                console.log('objectTemperature ' + objectTemperature + ', ambientTemperature ' + ambientTemperature);
                            });
                        });
                    });

                });
                */
/*
            });
        }

        console.log('DiscoverSensorTag(' + tagUUID + '): setting discoveryInProgress = false');
        discoveryInProgress = false;
    }, tagUUID
    );
};
*/


function smStrobe() {
    if( StateGeneratedEvent !== null ) {
        // setting 2nd arg to true to avoid notifying of same event erroneously
        sm.notifyEvent(StateGeneratedEvent, true, StateGeneratedEventArg);
    }
}

function startTimer() {
    setInterval(smStrobe, 250);
}

startTimer();

