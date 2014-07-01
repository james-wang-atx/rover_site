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
    console.log('stateFunction_idle_entry... smArgObj=' + JSON.stringify(smArgObj));

    if( smArgObj !== null ) {
        setTimeout(Delay_StateTransition_Timer, 10000, 'start', smArgObj);
    }
}
function stateFunction_idle_exit( smArgObj ) {
    //console.log('stateFunction_idle_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [connect]
function stateFunction_connect_entry( smArgObj ) {
    //console.log('stateFunction_connect_entry... smArgObj=' + JSON.stringify(smArgObj));
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
    //console.log('stateFunction_connect_exit... smArgObj=' + JSON.stringify(smArgObj));
}

var last_rssi = null;

// [poll_rssi]
function stateFunction_poll_rssi_entry( smArgObj ) {
    try {
        //console.log('stateFunction_poll_rssi_entry... smArgObj=' + JSON.stringify(smArgObj) + ', mySensorTag=' + mySensorTag);
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
    //console.log('stateFunction_poll_rssi_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [disconnect]
function stateFunction_disconnect_entry( smArgObj ) {
    console.log('stateFunction_disconnect_entry... smArgObj=' + JSON.stringify(smArgObj));
    DisconnectSensorTag(smArgObj);
}
function stateFunction_disconnect_exit( smArgObj ) {
    //console.log('stateFunction_disconnect_exit... smArgObj=' + JSON.stringify(smArgObj));
}

var temperature = { object: '', ambient: '' };
var tempSensorEnabled = false;

// [get_temperature]
function stateFunction_get_temperature_entry( smArgObj ) {
    //console.log('stateFunction_get_temperature_entry... smArgObj=' + JSON.stringify(smArgObj));

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
    //console.log('stateFunction_get_temperature_exit... smArgObj=' + JSON.stringify(smArgObj));
}

var LEFT_TURN_DUTY         = 0.5;
var LEFT_TURN_360_TIME_MS  = 2150;
var RIGHT_TURN_DUTY        = 0.5;
var RIGHT_TURN_360_TIME_MS = 2500;

var STD_FWD_DUTY   = 0.4;
var STD_FWD_TIMEMS = 500;
var STD_BCK_DUTY   = 0.4;
var STD_BCK_TIMEMS = 500;

// TEMP DEBUG:
var testcount = 1;

// [random_turn_0_to_90]
function stateFunction_random_turn_0_to_90_entry( smArgObj ) {
    console.log('stateFunction_random_turn_0_to_90_exit... smArgObj=' + JSON.stringify(smArgObj) + '(current rssi)');

    if( testcount-- <= 0 ) {
        NextStateMachineEvent    = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    var rnd1 = Math.random();
    var rnd2 = Math.random();

    var timeMs = 0;

    if( rnd1 > 0.5 ) {
        timeMs = rnd2 * LEFT_TURN_360_TIME_MS/4;
        console.log('stateFunction_random_step_entry: left: ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);
    } else {
        timeMs = rnd2 * RIGHT_TURN_360_TIME_MS/4;
        console.log('stateFunction_random_step_entry: right: ' + timeMs);
        motor.turnright(RIGHT_TURN_DUTY, timeMs);
    }

    // one-shot timer callback (includes xtra time for uss to settle)
    setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+1000, smArgObj);
}
function stateFunction_random_turn_0_to_90_exit( smArgObj ) {
    //console.log('stateFunction_random_turn_0_to_90_exit... smArgObj=' + JSON.stringify(smArgObj));
    EmptyRssiArray( smArgObj );
}

// [forward]
function stateFunction_forward_entry( smArgObj ) {
    motor.forward(STD_FWD_DUTY, STD_FWD_TIMEMS);
    // for now, no extra delay to let uss settle, since we're going to linger poll to let rssi settle
    setTimeout(Delay_StateTransition_Timer, STD_FWD_TIMEMS, 'done', smArgObj);
}
function stateFunction_forward_exit( smArgObj ) {
    //console.log('stateFunction_forward_exit... smArgObj=' + JSON.stringify(smArgObj));
    reset_pollcheck_repeat_count();
}

// [poll_check_and_track_rssi]
function stateFunction_poll_check_and_track_rssi_entry( smArgObj ) {
    console.log('stateFunction_poll_check_and_track_rssi_exit... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    var previous_rssi = smArgObj.rssiToBeat;

    mySensorTag._peripheral.updateRssi(function (err, rssi) {
        last_rssi = rssi;
        ComputeMMA_rssi(rssi);

        mmavalue = GetMMA_rssi();

        if( mmavalue !== MMA_unknown && get_and_decr_pollcheck_rssi_repeat_count() === 0 ) {
            console.log('RWK-pollcheck rssi: err = ' + err + 
                        ', last_rssi = ' + last_rssi + 
                        ', MMA_rssi = ' + GetMMA_rssi() + ', f2i = ', float2int(mmavalue) + 
                        ', prev = ' + previous_rssi );

            // add rssi data point to array
            smArgObj.rssiArray.push(mmavalue);

            if( float2int(mmavalue) >= MMA_RSSI_CLOSEST ) {
                console.log('RWK-updateRssi: reached MMA_RSSI_CLOSEST (' + MMA_RSSI_CLOSEST + ')');
                NextStateMachineEvent    = 'rssi_is_highest';
                NextStateMachineEventArg = null;
            } else if( smArgObj.rssiArray.length < 3 ) {
                console.log('RWK-pollcheck:COUNTING: mmavalue ' + mmavalue + ', array length = ' + smArgObj.rssiArray.length);
                NextStateMachineEvent    = 'more_steps';
                NextStateMachineEventArg = smArgObj;
                //smArgObj.rssiToBeat      = mmavalue;
            } else if ( RSSIAppearsWeaker( smArgObj ) ) {
                console.log('RWK-pollcheck:LOWER: mmavalue ' + mmavalue + ', RSSIAppearsWeaker() = true');
                NextStateMachineEvent    = 'rssi_is_lower';
                NextStateMachineEventArg = smArgObj;
            } else {
                console.log('RWK-pollcheck:NOT_LOWER: mmavalue ' + mmavalue + ', array length = ' + smArgObj.rssiArray.length);
                NextStateMachineEvent    = 'more_steps';
                NextStateMachineEventArg = smArgObj;
            }
        } else {
            console.log('RWK-pollcheck rssi:need_more_rssi: err = ' + err + 
                        ', last_rssi = ' + last_rssi + 
                        ', MMA_rssi = ' + GetMMA_rssi() + 
                        ', prev = ' + previous_rssi );
            NextStateMachineEvent    = 'need_more_rssi';
            NextStateMachineEventArg = smArgObj; // cycle smArgObj to self
        }
    });    
}
function stateFunction_poll_check_and_track_rssi_exit( smArgObj ) {
    //console.log('stateFunction_poll_check_and_track_rssi_exit... smArgObj=' + JSON.stringify(smArgObj));
    reset_turn_90_substate_count();
}

// [check_uss]
function stateFunction_check_uss_entry( smArgObj ) {
    uss.frontInches(CheckUSSCB_SetSMEvent, smArgObj);
}
function stateFunction_check_uss_exit( smArgObj ) {
    //console.log('stateFunction_check_uss_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [turn_180]
function stateFunction_turn_180_entry( smArgObj ) {
    console.log('stateFunction_turn_180_entry... smArgObj=' + JSON.stringify(smArgObj));

    var TimeFor180Ms = LEFT_TURN_360_TIME_MS/2;

    motor.turnleft(LEFT_TURN_DUTY, TimeFor180Ms);

    // one-shot timer callback
    setTimeout(Delay_StateTransition_Timer, TimeFor180Ms, 'done', smArgObj );
}
function stateFunction_turn_180_exit( smArgObj ) {
    //console.log('stateFunction_turn_180_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [forward_n]
function stateFunction_forward_n_entry( smArgObj ) {
    console.log('stateFunction_forward_n_entry... smArgObj=' + JSON.stringify(smArgObj));
    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    if ( typeof smArgObj.n === 'undefined' || smArgObj.n === null || smArgObj.n === 0 ) {
        smArgObj.n = CountWeakRSSIStepsToUndo( smArgObj );
        smArgObj.r = smArgObj.rssiArray.length - smArgObj.n;
        console.log('stateFunction_forward_n_entry:INIT COUNTS: n = ' + smArgObj.n + ', r = ' + smArgObj.r);
    }

    if( smArgObj.n <= 0 ) {
        if( smArgObj.r <= 0 ) {
            NextStateMachineEvent = 'all_steps_undone';
            NextStateMachineEventArg = smArgObj;
            console.log('stateFunction_forward_n_entry: all_steps_undone');
        } else {
            NextStateMachineEvent = 'kept_a_step';
            NextStateMachineEventArg = smArgObj;
            console.log('stateFunction_forward_n_entry: kept_a_step');
        }
    } else {
        smArgObj.n--;
        motor.forward(STD_FWD_DUTY, STD_FWD_TIMEMS);
        setTimeout(Delay_StateTransition_Timer, STD_FWD_TIMEMS, 'more_steps', smArgObj);
        console.log('stateFunction_forward_n_entry:stepping: decr n = ' + smArgObj.n);
    }
}
function stateFunction_forward_n_exit( smArgObj ) {
    //console.log('stateFunction_forward_n_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [turn_90]
function stateFunction_turn_90_entry( smArgObj ) {
    console.log('stateFunction_turn_90_entry... smArgObj=' + JSON.stringify(smArgObj));

    if( testcount-- <= 0 ) {
        NextStateMachineEvent    = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    var timeMs = 0;

    var substatecount = get_and_incr_turn_90_repeat_count();
    console.log('stateFunction_turn_90_entry: substatecount = ' + substatecount );
    if( substatecount == 1 )
    {
        // left 90 degrees
        timeMs = LEFT_TURN_360_TIME_MS/4;
        console.log('stateFunction_turn_90_entry: left:[90] ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);

        // one-shot timer callback, using SAME callback as 'random_step' state (i.e., this state must handle same two outcome events)
        setTimeout(TurnWaitTimerCB_Check_USS_Fwd_if_clear, timeMs+1000, smArgObj);
        // reset_pollcheck_repeat_count() is also called before transition to poll check state
    } else if( substatecount == 2 ) {
        // left 180, which is equivalent to right 90 degrees from starting position
        timeMs = LEFT_TURN_360_TIME_MS/2;
        console.log('stateFunction_turn_90_entry: left:[180] ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);

        // if clear (no obstacle), go to normal poll_check_rssi state
        // just use 'obstacle' and 'no_obstacle' events... //smArgObj.pollCheckEvent = 'check_rssi_change';

        // one-shot timer callback, using SAME callback as 'random_step' state (i.e., this state must handle same two outcome events)
        setTimeout(TurnWaitTimerCB_Check_USS_Fwd_if_clear, timeMs+1000, smArgObj);
        // reset_pollcheck_repeat_count() is also called before transition to poll check state
    } else if( substatecount == 3 ) {
        timeMs = RIGHT_TURN_360_TIME_MS/4;
        console.log('stateFunction_turn_90_entry: right:[90] ' + timeMs);
        motor.turnright(RIGHT_TURN_DUTY, timeMs);

        // go to 'start_escape' -- this will start the "ESCAPE" sequence, which will no longer require smArgObj, though we retain it
        //   in order to re-enter the walk (@ 'random_turn_0_to_90')
        setTimeout(Delay_StateTransition_Timer, timeMs, 'double_obstacle', smArgObj);
    } else {
        console.log('stateFunction_turn_90_entry: substate error!');
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
    }
}
function stateFunction_turn_90_exit( smArgObj ) {
    //console.log('stateFunction_turn_90_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [start_escape]
function stateFunction_start_escape_entry( smArgObj ) {
    console.log('stateFunction_start_escape_entry... smArgObj=' + JSON.stringify(smArgObj));
    
    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    // pick a random number (steps) and go to 'escape_turn_0_to_90'
    var rnd = Math.random();

    smArgObj.escape_steps = 3 + rnd * 7;    // 3 to 10 steps

    NextStateMachineEvent = 'done';
    NextStateMachineEventArg = smArgObj;

    console.log('stateFunction_start_escape_entry: steps = ' + smArgObj.escape_steps);
}
function stateFunction_start_escape_exit( smArgObj ) {
    //console.log('stateFunction_start_escape_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [escape_turn_0_to_90]
function stateFunction_escape_turn_0_to_90_entry( smArgObj ) {
    console.log('stateFunction_escape_turn_0_to_90_entry... smArgObj=' + JSON.stringify(smArgObj) + '(current rssi)');

    if( testcount-- <= 0 ) {
        NextStateMachineEvent    = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    var special_multiplier = 1;

    if( typeof smArgObj.escape_special !== 'undefined' && smArgObj.escape_special === true ) {
        smArgObj.escape_special = false;
        special_multiplier = 2;
    }

    var rnd1 = Math.random();
    var rnd2 = Math.random();

    var timeMs = 0;

    if( rnd1 > 0.5 ) {
        // 90 degress left max
        timeMs = rnd2 * LEFT_TURN_360_TIME_MS/4 * special_multiplier;
        console.log('stateFunction_random_step_entry: left: ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);
    } else {
        // 90 degrees right max
        timeMs = rnd2 * RIGHT_TURN_360_TIME_MS/4 * special_multiplier;
        console.log('stateFunction_random_step_entry: right: ' + timeMs);
        motor.turnright(RIGHT_TURN_DUTY, timeMs);
    }

    // one-shot timer callback (includes xtra time for uss to settle)
    setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+1000, smArgObj);
}
function stateFunction_escape_turn_0_to_90_exit( smArgObj ) {
    //console.log('stateFunction_escape_turn_0_to_90_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [escape_forward]
function stateFunction_escape_forward_entry( smArgObj ) {
    if (    typeof smArgObj  === 'undefined' || smArgObj === null
         || typeof smArgObj.escape_steps === 'undefined' || smArgObj.escape_steps === null || smArgObj.escape_steps === 0 ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    motor.forward(STD_FWD_DUTY, STD_FWD_TIMEMS);
    
    --smArgObj.escape_steps;

    if( smArgObj.escape_steps <= 0 ) {
        setTimeout(Delay_StateTransition_Timer, STD_FWD_TIMEMS+1000, 'done', smArgObj);
    } else {
        setTimeout(Delay_StateTransition_Timer, STD_FWD_TIMEMS+1000, 'more_steps', smArgObj);
    }
}
function stateFunction_escape_forward_exit( smArgObj ) {
    //console.log('stateFunction_escape_forward_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [escape_check_uss]
function stateFunction_escape_check_uss_entry( smArgObj ) {
    uss.frontInches(CheckUSSCB_SetSMEvent_SPECIAL, smArgObj);
}
function stateFunction_escape_check_uss_exit( smArgObj ) {
    //console.log('stateFunction_escape_check_uss_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [escape_turn_180]
function stateFunction_escape_turn_180_entry( smArgObj ) {
    console.log('stateFunction_escape_turn_180_entry... smArgObj=' + JSON.stringify(smArgObj));

    var TimeFor180Ms = LEFT_TURN_360_TIME_MS/2;

    motor.turnleft(LEFT_TURN_DUTY, TimeFor180Ms);

    // one-shot timer callback
    setTimeout(Delay_StateTransition_Timer, TimeFor180Ms, 'done', smArgObj );
}
function stateFunction_escape_turn_180_exit( smArgObj ) {
    //console.log('stateFunction_turn_180_exit... smArgObj=' + JSON.stringify(smArgObj));
    reset_pollcheck_repeat_count();
}

// [poll_rssi_restart_walk]
function stateFunction_poll_rssi_restart_walk_entry( smArgObj ) {
    console.log('stateFunction_poll_rssi_restart_walk_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    var previous_rssi = smArgObj.rssiToBeat;

    mySensorTag._peripheral.updateRssi(function (err, rssi) {
        last_rssi = rssi;
        ComputeMMA_rssi(rssi);

        mmavalue = GetMMA_rssi();

        if( mmavalue !== MMA_unknown && get_and_decr_pollcheck_rssi_repeat_count() === 0 ) {
            console.log('pollcheck rssi-RESTART WALK: err = ' + err + 
                        ', last_rssi = ' + last_rssi + 
                        ', MMA_rssi = ' + GetMMA_rssi() + ', f2i = ', float2int(mmavalue) + 
                        ', prev = ' + previous_rssi );

            // This is not necessary here, since this will be done again in "stateFunction_random_turn_0_to_90_exit()",
            //   but, since we are setting the rssiToBeat here, we might as well clear the array to avoid any confusion.
            EmptyRssiArray( smArgObj );

            smArgObj.rssiToBeat      = mmavalue;
            NextStateMachineEvent    = 'done';
            NextStateMachineEventArg = smArgObj;
        } else {
            NextStateMachineEvent    = 'need_more_rssi';
            NextStateMachineEventArg = smArgObj; // cycle smArgObj to self
        }
    });    
}
function stateFunction_poll_rssi_restart_walk_exit( smArgObj ) {
    //console.log('stateFunction_poll_rssi_restart_walk_exit... smArgObj=' + JSON.stringify(smArgObj));
}

var debug_dock_counter = 0;

// [random_walk_done]
function stateFunction_random_walk_done_entry( smArgObj ) {
    console.log('stateFunction_random_walk_done_entry... smArgObj=' + JSON.stringify(smArgObj));

    // TODO: final docking procedure
    if( debug_dock_counter++ < 10 ) {
        NextStateMachineEvent    = 'dock_and_charge'; //spin here
        NextStateMachineEventArg = null;
    } else {
        NextStateMachineEvent    = 'charge_done';
        NextStateMachineEventArg = null;
        debug_dock_counter = 0
    }
}
function stateFunction_random_walk_done_exit( smArgObj ) {
    //console.log('stateFunction_random_walk_done_exit... smArgObj=' + JSON.stringify(smArgObj));
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
        'name':'poll_rssi',
        'events':{
            'disconnect': 'disconnect',
            'poll': 'poll_rssi',
            'get_temp': 'get_temperature',
            'rnd_walk': 'random_turn_0_to_90',      // smArgObj contains current rssi (= rssi to beat)
            'disconnect_success': 'idle'
        },
        'state_functions' : {
            'entry': stateFunction_poll_rssi_entry,
            'exit': stateFunction_poll_rssi_exit
        }
    },
    {
        'name':'random_turn_0_to_90',
        'events': {
            'error': 'poll_rssi',
            'obstacle': 'random_0_to_90',           // re-enter same state (theoretically could get stuck here forever)
            'no_obstacle': 'forward'
        },
        'state_functions' : {
            'entry': stateFunction_random_turn_0_to_90_entry,
            'exit': stateFunction_random_turn_0_to_90_exit
        }
    },
    {
        'name':'forward',
        'events': {
            'error': 'poll_rssi',
            'done': 'poll_check_and_track_rssi'
        },
        'state_functions' : {
            'entry': stateFunction_forward_entry,
            'exit': stateFunction_forward_exit
        }
    },
    {
        'name':'poll_check_and_track_rssi',
        'events': {
            'error': 'poll_rssi',
            'need_more_rssi': 'poll_check_and_track_rssi',    // keep cycling to get more rssi readings
            'more_steps': 'check_uss',
            'rssi_is_lower': 'turn_180',
            'rssi_is_highest': 'random_walk_done'
        },
        'state_functions' : {
            'entry': stateFunction_poll_check_and_track_rssi_entry,
            'exit': stateFunction_poll_check_and_track_rssi_exit
        }
    },
    {
        'name':'check_uss',
        'events': {
            'error': 'poll_rssi',
            'obstacle': 'turn_90',
            'no_obstacle': 'forward'
        },
        'state_functions' : {
            'entry': stateFunction_check_uss_entry,
            'exit': stateFunction_check_uss_exit
        }
    },
    {
        'name':'turn_180',
        'events': {
            'done': 'forward_n'
        },
        'state_functions' : {
            'entry': stateFunction_turn_180_entry,
            'exit': stateFunction_turn_180_exit
        }
    },
    {
        'name':'forward_n',
        'events': {
            'error': 'poll_rssi',
            'more_steps': 'forward_n',
            'all_steps_undone': 'check_uss',        // we undid all steps in segment array, now go in opposite direction (since this last direction was wrong, opposite may be correct)
            'kept_a_step': 'turn_90'
        },
        'state_functions' : {
            'entry': stateFunction_forward_n_entry,
            'exit': stateFunction_forward_n_exit
        }
    },
    {
        'name':'turn_90',
        'events': {
            'error': 'poll_rssi',
            'obstacle': 'turn_90',              // re-enter same state (theoretically could get stuck here forever)
            'no_obstacle': 'random_turn_0_to_90',
            'double_obstacle': 'start_escape'   // turn back in direction we came from and go backwards to restart walk
        },
        'state_functions' : {
            'entry': stateFunction_turn_90_entry,
            'exit': stateFunction_turn_90_exit
        }
    },
    {
        'name':'start_escape',
        'events': {
            'done': 'escape_turn_0_to_90'       // smArgObj contains random count of forward steps to take
        },
        'state_functions' : {
            'entry': stateFunction_start_escape_entry,
            'exit': stateFunction_start_escape_exit
        }
    },
    {
        // same as random_turn_0_to_90, but we no longer care about rssi, just escaping blockage to establish new rssi to beat
        'name':'escape_turn_0_to_90',
        'events': {
            'error': 'poll_rssi',
            'obstacle': 'escape_turn_0_to_90',  // re-enter same state (theoretically could get stuck here forever)
            'no_obstacle': 'escape_forward'     // smArgObj contains random number of forward steps to take
        },
        'state_functions' : {
            'entry': stateFunction_escape_turn_0_to_90_entry,
            'exit': stateFunction_escape_turn_0_to_90_exit
        }
    },
    {
        'name':'escape_forward',
        'events': {
            'error': 'poll_rssi',
            'more_steps': 'escape_check_uss',   // smArgObj contains running count number of forward steps remaining
            'done': 'escape_turn_180'
        },
        'state_functions' : {
            'entry': stateFunction_forward_entry,
            'exit': stateFunction_forward_exit
        }
    },
    {
        'name':'escape_check_uss',
        'events': {
            'error': 'poll_rssi',
            'obstacle': 'escape_turn_0_to_90',  // smArgObj contains running count number of forward steps remaining, used as steps to take after rnd turn
            'no_obstacle': 'escape_forward'
        },
        'state_functions' : {
            'entry': stateFunction_escape_check_uss_entry,
            'exit': stateFunction_escape_check_uss_exit
        }
    },
    {
        'name':'escape_turn_180',
        'events': {
            'done': 'poll_rssi_restart_walk'
        },
        'state_functions' : {
            'entry': stateFunction_escape_turn_180_entry,
            'exit': stateFunction_escape_turn_180_exit
        }
    },
    {
        'name':'poll_rssi_restart_walk',
        'events':{
            'need_more_rssi': 'poll_rssi_restart_walk',
            'done': 'random_turn_0_to_90',      // smArgObj contains current rssi (= rssi to beat)
        },
        'state_functions' : {
            'entry': stateFunction_poll_rssi_restart_walk_entry,
            'exit': stateFunction_poll_rssi_restart_walk_exit
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
                                 rssiArray: [] };
                CommandGeneratedEvent = 'rnd_walk';
                CommandGeneratedEventArg = smArgObj;

                testcount = 1; // re-arm test code
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

function TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events(smArgObj) {
    console.log('TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events: calling uss.frontInches() - smArgObj = ' + smArgObj);
    // check ultrasonic after turn completes, and set event to go to next state
    uss.frontInches(CheckUSSCB_SetSMEvent, smArgObj);
}

function CheckUSSCB_SetSMEvent(distanceFloat, smArgObj) {
    if( distanceFloat > 9.0 ) {
        console.log('CheckUSSCB_SetSMEvent: ' + distanceFloat + ' inches, ' + smArgObj + ' _____ CLEAR _____');
        NextStateMachineEvent    = 'no_obstacle';
        NextStateMachineEventArg = smArgObj; //forward the previous rssi        
    } else {
        console.log('CheckUSSCB_SetSMEvent: ' + distanceFloat + 'inches, ' + smArgObj + '#_#_#_#_# BLOCKED #_#_#_#_#');
        NextStateMachineEvent    = 'obstacle';
        NextStateMachineEventArg = smArgObj; //pass along rssi to self
    }
}

function CheckUSSCB_SetSMEvent_SPECIAL(distanceFloat, smArgObj) {
    if( distanceFloat > 9.0 ) {
        console.log('CheckUSSCB_SetSMEvent_SPECIAL: ' + distanceFloat + ' inches, ' + smArgObj + ' _____ CLEAR _____');
        NextStateMachineEvent    = 'no_obstacle';
        NextStateMachineEventArg = smArgObj; //forward the previous rssi        
    } else {
        console.log('CheckUSSCB_SetSMEvent_SPECIAL: ' + distanceFloat + 'inches, ' + smArgObj + '#_#_#_#_# BLOCKED #_#_#_#_#');
        smArgObj.escape_special = true;
        NextStateMachineEvent    = 'obstacle';
        NextStateMachineEventArg = smArgObj; //pass along rssi to self
    }
}

function Delay_StateTransition_Timer(stateEvent, smArgObj) {
    NextStateMachineEvent    = stateEvent;
    NextStateMachineEventArg = smArgObj;
}

// this method is supposedly as fast as (or faster than) any of the alternatives
function EmptyRssiArray( smArgObj ) {
    while(smArgObj.rssiArray.length > 0) {
        smArgObj.rssiArray.length.pop();
    }
}

function RSSIAppearsWeaker( smArgObj ) {
    // check for at least 2 data points where rssi is lower than smArgObj.rssiToBeat
    
    var lowcount = 0;

    var rssiToBeat_int = float2int( smArgObj.rssiToBeat );

    for	(index = 0; index < smArgObj.rssiArray.length; ++index) {
        var data_int = float2int( smArgObj.rssiArray[index] );

        console.log( 'RSSIAppearsWeaker: comparing data ' + data_int + ' < rssiToBeat ' + rssiToBeat_int + ' ?' );

        if( data_int < rssiToBeat_int ) {
            if( ++lowcount >= 2 ) {
                console.log( 'RSSIAppearsWeaker: return true' );
                return true;
            }
        }
    }

    return false;
}

function CountWeakRSSIStepsToUndo( smArgObj ) {
    var lowcount = 0;

    var rssiToBeat_int = float2int( smArgObj.rssiToBeat );

    for	(index = 0; index < smArgObj.rssiArray.length; ++index) {
        var data_int = float2int( smArgObj.rssiArray[index] );

        console.log( 'CountWeakRSSIStepsToUndo: comparing data ' + data_int + ' < rssiToBeat ' + rssiToBeat_int + ' ?' );

        // the first weak rssi data point, will mean that step associated with that point and all subsequent points/steps should
        //   be "undone" or reversed.

        if( data_int < rssiToBeat_int ) {
            console.log( 'CountWeakRSSIStepsToUndo:1st weak pnt: ' + data_int + ' < ' + rssiToBeat_int + ' - index = ' + index);            
            return ( smArgObj.rssiArray.length - index );
        }
    }

    return 0;
}

//////////////////////////////////////////////////

var MMA_RSSI_CLOSEST = -59;

var MMA_rssi    = 0;
var MMA_n       = 3;
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

var pollcheck_rssi_repeat_count;

function reset_pollcheck_repeat_count() {
    pollcheck_rssi_repeat_count = 20;
    console.log('reset_pollcheck_repeat_count: set to ' + pollcheck_rssi_repeat_count);
}

function get_and_decr_pollcheck_rssi_repeat_count() {
    console.log('get_and_decr_pollcheck_rssi_repeat_count: count = ' + pollcheck_rssi_repeat_count);
    if( pollcheck_rssi_repeat_count > 0 ) {
        var retval = pollcheck_rssi_repeat_count;
        pollcheck_rssi_repeat_count = pollcheck_rssi_repeat_count - 1;
        console.log('get_and_decr_pollcheck_rssi_repeat_count: returning ' + retval + ', decremented count = ' + pollcheck_rssi_repeat_count);
        return retval;
    } else {
        console.log('get_and_decr_pollcheck_rssi_repeat_count: returning 0!');
        return 0;
    }
}

//////////////////////////////////////////////////

var turn_90_substate_count = 0;

function reset_turn_90_substate_count() {
    turn_90_substate_count = 0;
}

function get_and_incr_turn_90_repeat_count() {
    return turn_90_substate_count++;
}