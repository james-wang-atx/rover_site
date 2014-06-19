var fs        = require('/usr/lib/node_modules/fs-ext/fs-ext.js');
var bone      = require('bonescript');
var noble     = require('noble');
var SensorTag = require('sensortag');

var mySensorTag = null;
var lastRSSI    = null;

///////////////////////////////////
// State Transition variable     //
///////////////////////////////////
var NextStateMachineEvent     = null;
var NextStateMachineEventArg  = null;

function clearNextStateMachineEvent() {
    NextStateMachineEvent    = null;
    NextStateMachineEventArg = null;
}

/////////////////////////////////////////////////
// Command variable which will take precedence //
//   over State Transition variable            //
/////////////////////////////////////////////////
var CommandGeneratedEvent    = null;
var CommandGeneratedEventArg = null;

function clearCommandGeneratedEvent() {
    CommandGeneratedEvent    = null;
    CommandGeneratedEventArg = null;
}

///////////////////////////////////////////////////////////////
// State functions                                           //
///////////////////////////////////////////////////////////////

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
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    // success of connection will cause transition to poll_rssi
    DiscoverSensorTagAndConnect( arg );
}
function stateFunction_connect_exit( arg ) {
    console.log('stateFunction_connect_exit... arg=' + arg);
}

var last_rssi = null;

function stateFunction_poll_rssi_entry( arg ) {
    console.log('stateFunction_poll_rssi_entry... arg=' + arg + ', mySensorTag=' + mySensorTag);
    mySensorTag._peripheral.updateRssi(function (err, rssi) {
        last_rssi = rssi;
        //console.log('updateRssi: err = ' + err + ', rssi = ' + last_rssi);
        process.send({ rssi: last_rssi });
    });

    // default behavior --> poll again
    NextStateMachineEvent    = 'poll';
    NextStateMachineEventArg = null;
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

var temperature = { object: '', ambient: '' };
var tempSensorEnabled = false;

function stateFunction_get_temperature_entry( arg ) {
    console.log('stateFunction_get_temperature_entry... arg=' + arg);

    if(tempSensorEnabled === false) {
        mySensorTag.discoverServicesAndCharacteristics(function () {
            console.log('discovered characteristics');

            mySensorTag.enableIrTemperature(function () {
                
                tempSensorEnabled = true;
                console.log('enabled temperature in sensortag!');

                mySensorTag.readIrTemperature(function (objectTemperature, ambientTemperature) {
                    console.log('objectTemperature ' + objectTemperature + ', ambientTemperature ' + ambientTemperature);
                    temperature.object = objectTemperature;
                    temperature.ambient = ambientTemperature;
                    process.send({ temperature: temperature });

                    // transition to next state only upon success...or timeout?
                    NextStateMachineEvent    = 'get_success';
                    NextStateMachineEventArg = null;

                });
            });
        });
    } else {
        mySensorTag.readIrTemperature(function (objectTemperature, ambientTemperature) {
            console.log('objectTemperature ' + objectTemperature + ', ambientTemperature ' + ambientTemperature);
            temperature.object = objectTemperature;
            temperature.ambient = ambientTemperature;
            process.send({ temperature: temperature });

            // transition to next state only upon success...or timeout?
            NextStateMachineEvent    = 'get_success';
            NextStateMachineEventArg = null;
        });
    }
}
function stateFunction_get_temperature_exit( arg ) {
    console.log('stateFunction_get_temperature_exit... arg=' + arg);
}

////////////////////////////////////
// Main States array              //
////////////////////////////////////

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
            'get_success': 'poll_rssi',
            'get_temp': 'get_temperature'
        },
        'state_functions' : {
            'entry': stateFunction_get_temperature_entry,
            'exit': stateFunction_get_temperature_exit
        }
    }
];

///////////////////////////////////////
// State Machine constructor         //
///////////////////////////////////////

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
            console.log('notifyEvent: calling clearNextStateMachineEvent()');
            clearNextStateMachineEvent();
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
		} else {
            console.log('notifyEvent: Current: ' + this.currentState.name + ', IGNORING event: ' + SMEName );
        }
	}

	this.getStatus = function(){
		return this.currentState.name;
	}
}

/////////////////////////////////////
// Create the State Machine object //
/////////////////////////////////////

sm = new StateMachine(states);

///////////////////////////////////////////////////////////
// Process Message Handler (Messages from Parent app.js) //
///////////////////////////////////////////////////////////

process.on('message', function (m) {
    console.log('CHILD got message:', m);
    if (typeof m.hello !== 'undefined' && typeof m.myTag !== 'undefined') {
        if( sm.getStatus() === 'idle' ) {
            sm.notifyEvent('start', false, m.myTag);
        }
    } else if( m.command !== 'undefined') {
        if(m.command === 'get_temp') {
            //TODO: mutex the exclude timer function?
            CommandGeneratedEvent = 'get_temp';
            CommandGeneratedEventArg = null;
        }
    }
});

process.send({ foo: 'bar' });

//////////////////////////////////////////////
// Timer-based strobe for the State Machine //
//////////////////////////////////////////////

function smStrobe() {

    // inject external event into the state machine
    if(CommandGeneratedEvent !== null) {
        NextStateMachineEvent    = CommandGeneratedEvent;
        NextStateMachineEventArg = CommandGeneratedEventArg;
        clearCommandGeneratedEvent();
    }

    if( NextStateMachineEvent !== null ) {
        // setting 2nd arg to true to clear the event (prevent doing it again)
        sm.notifyEvent(NextStateMachineEvent, true, NextStateMachineEventArg);
    }
}

function startTimer() {
    setInterval(smStrobe, 250);
}

startTimer();

///////////////////////////////////////////////////////////////////
// Helper functions                                              //
///////////////////////////////////////////////////////////////////

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
                NextStateMachineEvent = 'connect_success';
                NextStateMachineEventArg = null;
            });
        }
    }, tagUUID
    );
};
