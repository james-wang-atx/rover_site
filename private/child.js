var fs        = require('/usr/lib/node_modules/fs-ext/fs-ext.js');
var bone      = require('bonescript');
var noble     = require('noble');
var SensorTag = require('sensortag');
var motor     = require('./motor');
var uss       = require('./uss');

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

// idle
function stateFunction_idle_entry( arg ) {
    console.log('stateFunction_idle_entry... arg=' + arg);
}
function stateFunction_idle_exit( arg ) {
    console.log('stateFunction_idle_exit... arg=' + arg);
}

// connect
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

// poll_rssi
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

// disconnect
function stateFunction_disconnect_entry( arg ) {
    console.log('stateFunction_disconnect_entry... arg=' + arg);
}
function stateFunction_disconnect_exit( arg ) {
    console.log('stateFunction_disconnect_exit... arg=' + arg);
}

var temperature = { object: '', ambient: '' };
var tempSensorEnabled = false;

// get_temperature
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

// random_step
function stateFunction_random_step_entry( arg ) {
    console.log('stateFunction_random_step_entry... arg=' + arg + '(current rssi)');

    // TODO: RANDOM TURN AND THEN FWD
    var rnd1 = Math.random(); //todo
    var rnd2 = Math.random(); //todo

    var timeMs = rnd2 * 1000;

    if( rnd1 > 0.5 ) {
        console.log('stateFunction_random_step_entry: left: ' + timeMs);
        motor.turnleft(0.4, timeMs);
    } else {
        console.log('stateFunction_random_step_entry: right: ' + timeMs);
        motor.turnright(0.4, timeMs);
    }

    // check ultrasonic, if ok...
    uss.frontInches(RndStep_CheckUSSAndGoNextState, arg);
}
function stateFunction_random_step_exit( arg ) {
    console.log('stateFunction_random_step_exit... arg=' + arg);
}

// poll_check_rssi
function stateFunction_poll_check_rssi_entry( arg ) {
    console.log('stateFunction_poll_check_rssi_entry... arg=' + arg + '(rssi before last step)');

    var previous_rssi = arg;

    // TODO: READ RSSI AND COMPARE TO arg

    var current_rssi; //=?
    
    if( current_rssi <= previous_rssi ) { 
        NextStateMachineEvent    = 'rssi_is_lower';
    } else {
        NextStateMachineEvent    = 'rssi_is_higher';
    }

    NextStateMachineEventArg = null;
}
function stateFunction_poll_check_rssi_exit( arg ) {
    console.log('stateFunction_poll_check_rssi_exit... arg=' + arg);
}

// undo_step
function stateFunction_undo_step_entry( arg ) {
    console.log('stateFunction_undo_step_entry... arg=' + arg);

    // TODO: GO BACKWARDS PRESCRIBED AMOUNT OF TIME
    motor.reverse(0.4, 500);

    NextStateMachineEvent    = 'undo_done';;
    NextStateMachineEventArg = null;
}
function stateFunction_undo_step_exit( arg ) {
    console.log('stateFunction_undo_step_exit... arg=' + arg);
}

// random_walk_done
function stateFunction_random_walk_done_entry( arg ) {
    console.log('stateFunction_random_walk_done_entry... arg=' + arg);

    // TODO: final docking procedure

    NextStateMachineEvent    = 'dock_and_charge'; //spin here for now
    NextStateMachineEventArg = null;
}
function stateFunction_random_walk_done_exit( arg ) {
    console.log('stateFunction_random_walk_done_exit... arg=' + arg);
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
            'disconnect': 'disconnect',
            'poll': 'poll_rssi',
            'get_temp': 'get_temperature',
            'rnd_walk': 'random_step' // arg = current rssi
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
    },
    {
        'name':'random_step',
        'events': {
            'obstacle': 'random_step',             // re-enter same state with rssi in arg
            'error': 'poll_rssi',
            'check_rssi_change': 'poll_check_rssi' // arg = rssi before step
        },
        'state_functions' : {
            'entry': stateFunction_random_step_entry,
            'exit': stateFunction_random_step_exit
        }
    },
    {
        'name':'poll_check_rssi',
        'events': {
            'rssi_is_higher': 'undo_step',
            'rssi_is_lower': 'random_step',
            'rssi_is_lowest': 'random_walk_done'
        },
        'state_functions' : {
            'entry': stateFunction_poll_check_rssi_entry,
            'exit': stateFunction_poll_check_rssi_exit
        }
    },
    {
        'name':'undo_step',
        'events': {
            'undo_done': 'random_step'
        },
        'state_functions' : {
            'entry': stateFunction_undo_step_entry,
            'exit': stateFunction_undo_step_exit
        }
    },
    {
        'name':'random_walk_done',
        'events': {
            'charge_done': 'poll_rssi',
            'dock_and_charge': 'random_walk_done'
        },
        'state_functions' : {
            'entry': stateFunction_random_walk_done_entry,
            'exit': stateFunction_random_walk_done_exit
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
            // (Note that the clearStateGenerated boolean should = false, for external command event)
            sm.notifyEvent('start', false, m.myTag);
        }
    } else if( m.command !== 'undefined') {
        if(m.command === 'get_temp') {
            // since javascript and node.js is single threaded, we won't
            //   need to mutex access to these globals
            CommandGeneratedEvent = 'get_temp';
            CommandGeneratedEventArg = null;

            //MotorsForward( 0.4, 500 );
        } else if(m.command === 'random_walk') {
            // (Note that the clearStateGenerated boolean should = false, for external command event)
            if( last_rssi !== null ) {
                CommandGeneratedEvent = 'rnd_walk';
                CommandGeneratedEventArg = last_rssi;
            } else {
                console.log('cannot start random walk, due to not having initial rssi');
            }
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

function RndStep_CheckUSSAndGoNextState(distanceFloat, arg) {
    if( distanceFloat > 9.0 ) {
        console.log('RndStep_CheckUSSAndGoNextState: ' + distanceFloat + ' inches, ' + arg + ' clear');
        // no obstacle in front, move forward
        motor.forward(0.4, 500);

        NextStateMachineEvent    = 'check_rssi_change';
        NextStateMachineEventArg = arg; //forward the previous rssi
    } else {
        console.log('RndStep_CheckUSSAndGoNextState: ' + distanceFloat + 'inches, ' + arg + ' blocked');
        // something blocking in front
        //   go back and choose another direction
        NextStateMachineEvent    = 'obstacle';
        NextStateMachineEventArg = arg; //pass along rssi to self
    }
}