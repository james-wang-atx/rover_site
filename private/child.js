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

// [idle]
function stateFunction_idle_entry( smArgObj ) {
    console.log('stateFunction_idle_entry... smArgObj=' + smArgObj);

    if( smArgObj !== null ) {
        setTimeout(DelayedConnectTimerCB, 10000, smArgObj);
    }
}
function stateFunction_idle_exit( smArgObj ) {
    //console.log('stateFunction_idle_exit... smArgObj=' + smArgObj);
}

// [connect]
function stateFunction_connect_entry( smArgObj ) {
    //console.log('stateFunction_connect_entry... smArgObj=' + smArgObj);
    if (    typeof smArgObj  === 'undefined' || smArgObj === null
         || typeof smArgObj.tagUUID === 'undefined' || smArgObj.tagUUID === null) {
        //error! cannot enter this state without giving SensorTag UUID to connect to.
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    // success of connection will cause transition to poll_rssi
    DiscoverSensorTagAndConnect( smArgObj );
}
function stateFunction_connect_exit( smArgObj ) {
    //console.log('stateFunction_connect_exit... smArgObj=' + smArgObj);
}

var last_rssi = null;

// [poll_rssi]
function stateFunction_poll_rssi_entry( smArgObj ) {
    try {
        //console.log('stateFunction_poll_rssi_entry... smArgObj=' + smArgObj + ', mySensorTag=' + mySensorTag);
        mySensorTag._peripheral.updateRssi(function (err, rssi) {
            last_rssi = rssi;
            ComputeMMA_rssi(rssi);
            if( GetMMA_rssi() !== MMA_unknown ) {
                console.log('updateRssi: err = ' + err + ', last_rssi = ' + last_rssi + ', MMA_rssi = ' + GetMMA_rssi() );
            }

            var rssiMMA = float2int(GetMMA_rssi());
            process.send({ rssi: last_rssi, rssiMMA: rssiMMA });
        });

        // default behavior --> poll again
        NextStateMachineEvent    = 'poll';
        NextStateMachineEventArg = smArgObj;
    }
    catch(err) {
        console.log('stateFunction_poll_rssi_entry:exception: ' + err.message );

        var smArgObj2 = { tagUUID: mySensorTag.uuid.toLowerCase() };
        NextStateMachineEvent    = 'disconnect';
        NextStateMachineEventArg = smArgObj2;
    }
}
function stateFunction_poll_rssi_exit( smArgObj ) {
    //console.log('stateFunction_poll_rssi_exit... smArgObj=' + smArgObj);
}

// [disconnect]
function stateFunction_disconnect_entry( smArgObj ) {
    console.log('stateFunction_disconnect_entry... smArgObj=' + smArgObj);
    DisconnectSensorTag(smArgObj);
}
function stateFunction_disconnect_exit( smArgObj ) {
    //console.log('stateFunction_disconnect_exit... smArgObj=' + smArgObj);
}

var temperature = { object: '', ambient: '' };
var tempSensorEnabled = false;

// [get_temperature]
function stateFunction_get_temperature_entry( smArgObj ) {
    //console.log('stateFunction_get_temperature_entry... smArgObj=' + smArgObj);

    if(tempSensorEnabled === false) {
        mySensorTag.discoverServicesAndCharacteristics(function () {
            //console.log('discovered characteristics');

            mySensorTag.enableIrTemperature(function () {
                
                tempSensorEnabled = true;
                //console.log('enabled temperature in sensortag!');

                mySensorTag.readIrTemperature(function (objectTemperature, ambientTemperature) {
                    //console.log('objectTemperature ' + objectTemperature + ', ambientTemperature ' + ambientTemperature);
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
            //console.log('objectTemperature ' + objectTemperature + ', ambientTemperature ' + ambientTemperature);
            temperature.object = objectTemperature;
            temperature.ambient = ambientTemperature;
            process.send({ temperature: temperature });

            // transition to next state only upon success...or timeout?
            NextStateMachineEvent    = 'get_success';
            NextStateMachineEventArg = null;
        });
    }
}
function stateFunction_get_temperature_exit( smArgObj ) {
    //console.log('stateFunction_get_temperature_exit... smArgObj=' + smArgObj);
}

var LEFT_TURN_DUTY         = 0.5;
var LEFT_TURN_360_TIME_MS  = 2150;
var RIGHT_TURN_DUTY        = 0.5;
var RIGHT_TURN_360_TIME_MS = 2500;

var STD_FWD_DUTY   = 0.4;
var STD_FWD_TIMEMS = 500;
var STD_BCK_DUTY   = 0.4;
var STD_BCK_TIMEMS = 500;

// [random_step]
function stateFunction_random_step_entry( smArgObj ) {
    console.log('stateFunction_random_step_entry... smArgObj=' + smArgObj + '(current rssi)');

    // TODO: RANDOM TURN AND THEN FWD
    var rnd1 = Math.random();
    var rnd2 = Math.random();

    var timeMs = 0;

    if( rnd1 > 0.5 ) {
        //restrict to 90 degrees
        timeMs = rnd2 * LEFT_TURN_360_TIME_MS/4;
        console.log('stateFunction_random_step_entry: left: ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);
    } else {
        //restrict to 90 degrees
        timeMs = rnd2 * RIGHT_TURN_360_TIME_MS/4;
        console.log('stateFunction_random_step_entry: right: ' + timeMs);
        motor.turnright(RIGHT_TURN_DUTY, timeMs);
    }

    // if clear (no obstacle), go to normal poll_check_rssi state
    smArgObj.pollCheckEvent = 'check_rssi_change';

    // one-shot timer callback
    setTimeout(TurnWaitTimerCB_Check_USS_Fwd_if_clear, timeMs, smArgObj);
    // reset_pollcheck_repeat_count() is also called before transition to poll check state
}
function stateFunction_random_step_exit( smArgObj ) {
    //console.log('stateFunction_random_step_exit... smArgObj=' + smArgObj);
}

// TEMP DEBUG:
var testcount = 3;

// [poll_check_rssi]
function stateFunction_poll_check_rssi_entry( smArgObj ) {
    console.log('stateFunction_poll_check_rssi_entry... smArgObj=' + smArgObj + '(rssi before last step)');

    var previous_rssi = smArgObj.rssiToBeat;

    mySensorTag._peripheral.updateRssi(function (err, rssi) {
        last_rssi = rssi;
        ComputeMMA_rssi(rssi);

        mmavalue = GetMMA_rssi();
        if( mmavalue !== MMA_unknown && get_and_decr_pollcheck_rssi_repeat_count() === 0 ) {
            console.log('RWK-updateRssi: err = ' + err + 
                        ', last_rssi = ' + last_rssi + 
                        ', MMA_rssi = ' + GetMMA_rssi() + ', f2i = ', float2int(mmavalue) + 
                        ', prev = ' + previous_rssi );

            if( float2int(mmavalue) >= MMA_RSSI_CLOSEST || testcount-- <= 0) {
                console.log('RWK-updateRssi: reached MMA_RSSI_CLOSEST (' + MMA_RSSI_CLOSEST + ')');
                NextStateMachineEvent    = 'rssi_is_highest';
                NextStateMachineEventArg = null;
            } else if( mmavalue > previous_rssi ) { 
                NextStateMachineEvent    = 'rssi_is_higher';
                smArgObj.rssiToBeat      = mmavalue;
                NextStateMachineEventArg = smArgObj;
            } else if( mmavalue < previous_rssi ) {
                NextStateMachineEvent    = 'rssi_is_lower';
                NextStateMachineEventArg = smArgObj; // need to pass to UNDO step then back to rand step
            } else {
                NextStateMachineEvent    = 'rssi_is_same'; // we're "tangential" to the SensorTag
                NextStateMachineEventArg = smArgObj;
            }
        } else {
            NextStateMachineEvent    = 'need_more_rssi';
            NextStateMachineEventArg = smArgObj; // cycle smArgObj to self
        }
    });    
}
function stateFunction_poll_check_rssi_exit( smArgObj ) {
    //console.log('stateFunction_poll_check_rssi_exit... smArgObj=' + smArgObj);
    reset_turn_90_substate_count();
}

// [turn_90_step]
function stateFunction_turn_90_entry( smArgObj ) {
    console.log('stateFunction_turn_90_step_entry... smArgObj=' + smArgObj);

    var timeMs = 0;

    var substatecount = get_and_incr_turn_90_repeat_count();
    if( substatecount == 1 )
    {
        //restrict to 90 degrees
        timeMs = LEFT_TURN_360_TIME_MS/4;
        console.log('stateFunction_turn_90_entry: left:[90] ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);

        // if clear (no obstacle), go to normal poll_check_rssi state
        smArgObj.pollCheckEvent = 'check_rssi_change';

        // one-shot timer callback, using SAME callback as 'random_step' state (i.e., this state must handle same two outcome events)
        setTimeout(TurnWaitTimerCB_Check_USS_Fwd_if_clear, timeMs, smArgObj);
        // reset_pollcheck_repeat_count() is also called before transition to poll check state
    } else if( substatecount == 2 ) {
        // if we get here, the 1st substate was blocked due to obstacle detected by ultrasonic sensor,
        //   we need to turn 180 to effectively make the "opposite choice" from substate 1

        timeMs = LEFT_TURN_360_TIME_MS/2;
        console.log('stateFunction_turn_90_entry: left:[180] ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);

        // if clear (no obstacle), go to normal poll_check_rssi state
        smArgObj.pollCheckEvent = 'check_rssi_change';

        // one-shot timer callback, using SAME callback as 'random_step' state (i.e., this state must handle same two outcome events)
        setTimeout(TurnWaitTimerCB_Check_USS_Fwd_if_clear, timeMs, smArgObj);
        // reset_pollcheck_repeat_count() is also called before transition to poll check state
    } else if( substatecount == 2 ) {
        // if we get here, the first 2 substates were block (so 90 degrees left and right from original position
        //   were blocked).  At this point 1 more left 90 degrees restores our original orientation (this is the
        //   reason we don't randomly turn left or right in substate 1)
        
        timeMs = LEFT_TURN_360_TIME_MS/4;
        console.log('stateFunction_turn_90_entry: left:[90] ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);

        // if clear (no obstacle), go to special poll-check state to establish new rssi to beat ('poll_new_rssi_and_turn_90') and then turn_90
        smArgObj.pollCheckEvent = 'need_new_rssi_and_turn_90';

        // one-shot timer callback, using SAME callback as 'random_step' state (i.e., this state must handle same two outcome events)
        setTimeout(TurnWaitTimerCB_Check_USS_Fwd_if_clear, timeMs, smArgObj);
        // reset_pollcheck_repeat_count() is also called before transition to poll check state
    } else {
        // this will cause state to go to 'undo_step' (go backwards and then 180 degree turn to go in other direction,
        //   then enter 'random_step' with no change to rssi to beat)
        NextStateMachineEvent    = 'triple_obstacle';
        NextStateMachineEventArg = smArgObj; //pass along rssi
    }
}
function stateFunction_turn_90_exit( smArgObj ) {
    //console.log('stateFunction_turn_90_step_exit... smArgObj=' + smArgObj);
}

// [poll_new_rssi_and_turn_90]
function stateFunction_poll_new_rssi_and_turn_90_entry( smArgObj ) {
    console.log('stateFunction_poll_new_rssi_and_turn_90_entry... smArgObj=' + smArgObj);

    var previous_rssi = smArgObj.rssiToBeat;

    mySensorTag._peripheral.updateRssi(function (err, rssi) {
        last_rssi = rssi;
        ComputeMMA_rssi(rssi);

        mmavalue = GetMMA_rssi();
        if( mmavalue !== MMA_unknown && get_and_decr_pollcheck_rssi_repeat_count() === 0 ) {
            console.log('RWK-NEW-RSSI-updateRssi: err = ' + err + 
                        ', last_rssi = ' + last_rssi + 
                        ', MMA_rssi = ' + GetMMA_rssi() + ', f2i = ', float2int(mmavalue) + 
                        ', prev = ' + previous_rssi );

            if( float2int(mmavalue) >= MMA_RSSI_CLOSEST || testcount-- <= 0) {
                console.log('RWK-updateRssi: reached MMA_RSSI_CLOSEST (' + MMA_RSSI_CLOSEST + ')');
                NextStateMachineEvent    = 'rssi_is_highest';
                NextStateMachineEventArg = null;
            } else { 
                NextStateMachineEvent    = 'new_rssi_done';
                smArgObj.rssiToBeat      = mmavalue;
                NextStateMachineEventArg = smArgObj;
            }
        } else {
            NextStateMachineEvent    = 'need_more_rssi';
            NextStateMachineEventArg = smArgObj; // cycle smArgObj to self
        }
    });    
}
function stateFunction_poll_new_rssi_and_turn_90_exit( smArgObj ) {
    //console.log('stateFunction_poll_new_rssi_and_turn_90_exit... smArgObj=' + smArgObj);
    reset_turn_90_substate_count();
}

// [undo_step]
function stateFunction_undo_step_entry( smArgObj ) {
    console.log('stateFunction_undo_step_entry... smArgObj=' + smArgObj);

    // TODO: GO BACKWARDS PRESCRIBED AMOUNT OF TIME
    motor.reverse(STD_BCK_DUTY, STD_BCK_TIMEMS);

    // one-shot timer callback
    setTimeout(Delay_StateTransition_Timer, STD_BCK_TIMEMS, 'undo_done', smArgObj );
}
function stateFunction_undo_step_exit( smArgObj ) {
    //console.log('stateFunction_undo_step_exit... smArgObj=' + smArgObj);
}

// [turn_180]
function stateFunction_turn_180_entry( smArgObj ) {
    console.log('stateFunction_turn_180_entry... smArgObj=' + smArgObj);

    var TimeFor180Ms = LEFT_TURN_360_TIME_MS/2;

    motor.turnleft(LEFT_TURN_DUTY, TimeFor180Ms);

    // one-shot timer callback
    setTimeout(Delay_StateTransition_Timer, TimeFor180Ms, '180_done', smArgObj );
}
function stateFunction_turn_180_exit( smArgObj ) {
    //console.log('stateFunction_turn_180_exit... smArgObj=' + smArgObj);
}

// [random_walk_done]
function stateFunction_random_walk_done_entry( smArgObj ) {
    console.log('stateFunction_random_walk_done_entry... smArgObj=' + smArgObj);

    // TODO: final docking procedure

    NextStateMachineEvent    = 'dock_and_charge'; //spin here for now
    NextStateMachineEventArg = null;
}
function stateFunction_random_walk_done_exit( smArgObj ) {
    //console.log('stateFunction_random_walk_done_exit... smArgObj=' + smArgObj);
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
            'rnd_walk': 'random_step', // smArgObj = current rssi
            'disconnect_success': 'idle'
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
        // This is no longer a full 360 degree random turn and step state.
        // The turn is restricted to between 0-90 degrees left or right.
        'name':'random_step',
        'events': {
            'obstacle': 'random_step',              // re-enter same state with rssi in smArgObj
            'check_rssi_change': 'poll_check_rssi', // smArgObj contains rssi before step
            'error': 'poll_rssi'
        },
        'state_functions' : {
            'entry': stateFunction_random_step_entry,
            'exit': stateFunction_random_step_exit
        }
    },
    {
        'name':'poll_check_rssi',
        'events': {
            'need_more_rssi': 'poll_check_rssi',    // keep cycling smArgObj
            'rssi_is_same': 'turn_90_step',
            'rssi_is_lower': 'undo_step',
            'rssi_is_higher': 'random_step',        // smArgObj contains new rssi to beat
            'rssi_is_highest': 'random_walk_done'
        },
        'state_functions' : {
            'entry': stateFunction_poll_check_rssi_entry,
            'exit': stateFunction_poll_check_rssi_exit
        }
    },
    {
        // This state is essentially same as 'random_step' state except it can
        //   only turn 90 degrees left or right.
        //   In addition to special conditions are handled:
        //      1. "double obstacle" = direction at 90 degress left and right has an obstacle according to ultrasonic sensor
        //                             In this case, we try to go forward, which should have a lower rssi than before, establish this as
        //                             new rssi to beat, and re-enter turn_90_step to establish a new hemispherical scope for the
        //                             path.  After turn_90_step, we'll return to random_step if there is no blockage
        //      2. "triple_obstacle" = 90 degrees left and right and straight ahead are blocked
        //                             In this case, we "undo_step" (go backwards) then turn_180, and restart at random_step
        'name':'turn_90_step',
        'events': {
            'obstacle': 'turn_90_step',             // return to same state, on 3rd-try, we giveup by straightening out to original fwd position
            'check_rssi_change': 'poll_check_rssi', // smArgObj contains rssi before step
            'need_new_rssi_and_turn_90': 'poll_new_rssi_and_turn_90',
            'triple_obstacle': 'undo_step',
            'error': 'poll_rssi'
        },
        'state_functions' : {
            'entry': stateFunction_turn_90_entry,
            'exit': stateFunction_turn_90_exit
        }
    },
    {
        'name':'poll_new_rssi_and_turn_90',
        'events': {
            'need_more_rssi': 'poll_new_rssi_and_turn_90',    // keep cycling smArgObj
            'new_rssi_done': 'turn_90_step',
            'rssi_is_highest': 'random_walk_done'
        },
        'state_functions' : {
            'entry': stateFunction_poll_new_rssi_and_turn_90_entry,
            'exit': stateFunction_poll_new_rssi_and_turn_90_exit
        }
    },
    {
        'name':'undo_step',
        'events': {
            'undo_done': 'turn_180'
        },
        'state_functions' : {
            'entry': stateFunction_undo_step_entry,
            'exit': stateFunction_undo_step_exit
        }
    },
    {
        'name':'turn_180',
        'events': {
            '180_done': 'random_step'
        },
        'state_functions' : {
            'entry': stateFunction_turn_180_entry,
            'exit': stateFunction_turn_180_exit
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

	this.notifyEvent = function( SMEName, clearStateGenerated, smArgObj ) {
        //console.log('notifyEvent: ' + SMEName + ', clearStateGenerated: ' + clearStateGenerated + ', smArgObj: ' + smArgObj);

        // each time we are called due to state generated event, we need to be told (i.e., clearStateGenerated=true)
        //   to clear the state generated event variables here, so as to avoid repeated notifying of the
        //   same event over-and-over.  This event variable holder cannot be cleared externally, since
        //   the 'entry' and 'exit' functions for each state may or may not set the variable again.
        if( clearStateGenerated === true ) {
            //console.log('notifyEvent: calling clearNextStateMachineEvent()');
            clearNextStateMachineEvent();
        }

		if( this.currentState.events[ SMEName ] ) {
            var nextStateName = this.currentState.events[ SMEName ];

            if( this.currentState.state_functions['exit'] !== 'undefined' ) {
                // call the current state's exit function
                this.currentState.state_functions['exit']( smArgObj );
            }

            // move to next state
			this.currentState = this.states[ this.stateNameToIndex[ nextStateName ] ] ;

            if( this.currentState.state_functions['entry'] !== 'undefined' ) {
                // call the new state's entry function
                this.currentState.state_functions['entry']( smArgObj );
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
            var smArgObj = { tagUUID: m.myTag };
            sm.notifyEvent('start', false, smArgObj);
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
            if( GetMMA_rssi() !== MMA_unknown ) {
                var smArgObj = { tagUUID: mySensorTag.uuid.toLowerCase(),
                                 rssiToBeat: GetMMA_rssi(),
                                 pollCheckEvent: null };
                CommandGeneratedEvent = 'rnd_walk';
                CommandGeneratedEventArg = smArgObj;
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
        // setting 2nd smArgObj to true to clear the event (prevent doing it again)
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

function float2int (value) {
    // In javascript, using bitwise operations on floating point values will convert
    //  them to an integer stripping off digits after decimal point
    return value | 0;
}

function DiscoverSensorTagAndConnect(smArgObj) {
    console.log('DiscoverSensorTagAndConnect(' + smArgObj.tagUUID + ')');
    SensorTag.discover(function (sensorTag) {
        console.log('SensorTag.discover: sensorTag = ' + sensorTag);

        if (sensorTag.uuid.toLowerCase() === smArgObj.tagUUID) {
            console.log('found my sensortag!');

            mySensorTag = sensorTag;

            sensorTag.connect(function () {
                console.log('connected to sensortag!');

                // setup event for next state
                NextStateMachineEvent = 'connect_success';
                NextStateMachineEventArg = null;
            });
        }
    }, smArgObj.tagUUID
    );
};

function DisconnectSensorTag(smArgObj) {
    if( mySensorTag !== null ) {
        
        try {
            mySensorTag.disconnect(function () {
                console.log('disconnected sensortag!');

                // setup event for next state
                NextStateMachineEvent = 'disconnect_success';
                NextStateMachineEventArg = smArgObj;
            });
        }
        catch(err) {
            console.log('DisconnectSensorTag:exception: ' + err.message );
            NextStateMachineEvent    = 'error';
            NextStateMachineEventArg = smArgObj;
        }
    }
    
    //Don't do this, to allow reconnect
    //if (    typeof smArgObj  !== 'undefined' && smArgObj !== null
    //     && typeof smArgObj.tagUUID !== 'undefined' && smArgObj.tagUUID !== null) {
    //     smArgObj.tagUUID = null;
    //}
}

function DelayedConnectTimerCB(smArgObj) {
    NextStateMachineEvent    = 'start';
    NextStateMachineEventArg = smArgObj; //pass along rssi to self
}

function TurnWaitTimerCB_Check_USS_Fwd_if_clear(smArgObj) {
    console.log('TurnWaitTimerCB_Check_USS_Fwd_if_clear: calling uss.frontInches() - smArgObj = ' + smArgObj);
    // check ultrasonic after turn completes, and set event to go to next state
    uss.frontInches(RndStep_CheckUSSAndGoNextState, smArgObj);
}

function RndStep_CheckUSSAndGoNextState(distanceFloat, smArgObj) {
    if( distanceFloat > 9.0 ) {
        console.log('RndStep_CheckUSSAndGoNextState: ' + distanceFloat + ' inches, ' + smArgObj + ' clear');
        
        // _CLEAR_ (no obstacle, go forward)
        motor.forward(STD_FWD_DUTY, STD_FWD_TIMEMS);

        // NOTE: there is no need to delay this state transition, since the next state
        //       has effectively a built in rssi repeated read/delay, which will consume
        //       at least 500 ms.

        NextStateMachineEvent    = smArgObj.pollCheckEvent; // normally = 'check_rssi_change', but could also be 'need_new_rssi_and_turn_90'
        NextStateMachineEventArg = smArgObj; //forward the previous rssi
        
        // force state to pause/linger to get a more accurate averaged reading
        reset_pollcheck_repeat_count();
    } else {
        console.log('RndStep_CheckUSSAndGoNextState: ' + distanceFloat + 'inches, ' + smArgObj + ' blocked');
        
        // _BLOCKED_
        //   go back and choose another direction
        NextStateMachineEvent    = 'obstacle';
        NextStateMachineEventArg = smArgObj; //pass along rssi to self
    }
}

function Delay_StateTransition_Timer(stateEvent, smArgObj) {
    NextStateMachineEvent    = stateEvent;
    NextStateMachineEventArg = smArgObj;
}

//////////////////////////////////////////////////

var MMA_RSSI_CLOSEST = -59;

var MMA_rssi    = 0;
var MMA_n       = 9;
var MMA_count   = 0;
var MMA_unknown = -1000.0;

function ComputeMMA_rssi(rssi) {
    MMA_rssi = ( (MMA_n - 1) * MMA_rssi + rssi ) / MMA_n;
    MMA_count++;
}

function GetMMA_rssi() {
    if(MMA_count > MMA_n) {
        return MMA_rssi;
    }
    return MMA_unknown;
}

//////////////////////////////////////////////////

var pollcheck_rssi_repeat_count = 0;

function reset_pollcheck_repeat_count() {
    pollcheck_rssi_repeat_count = MMA_n + 1;
}

function get_and_decr_pollcheck_rssi_repeat_count() {
    if( pollcheck_rssi_repeat_count > 0 ) {
        return pollcheck_rssi_repeat_count--;
    } else {
        return 0;
    }
}

//////////////////////////////////////////////////

var turn_90_substate_count = 0;

function reset_turn_90_substate_count() {
    pollcheck_rssi_repeat_count = 0;
}

function get_and_incr_turn_90_repeat_count() {
    return turn_90_substate_count++;
}