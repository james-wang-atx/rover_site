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
            var HILO = Get_rssiHL();

            if( GetMMA_rssi() !== MMA_unknown ) {
                console.log('updateRssi: err = ' + err + ', last_rssi = ' + last_rssi + ', HI = ' + HILO.HI + ', LO = ' + HILO.LO );
            }

            var rssiMMA = float2int(GetMMA_rssi());
            process.send( { rssi: last_rssi, rssiMMA: rssiMMA, rssiHI: HILO.HI, rssiLO: HILO.LO } );
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

var TURN_MODE_UNKNOWN      = -1;
var TURN_MODE_LEFT_90      =  0;
var TURN_MODE_RIGHT_90     =  1;
var TURN_MODE_RANDOM       =  2;

var LEFT_TURN_DUTY         = 0.5;
var LEFT_TURN_360_TIME_MS  = 2040;  // accurate when battery is nearly charged
var RIGHT_TURN_DUTY        = 0.5;
var RIGHT_TURN_360_TIME_MS = 2400;  // accurate when battery is nearly charged

var STD_FWD_DUTY   = 0.4;
var STD_FWD_TIMEMS = 500;
var STD_BCK_DUTY   = 0.4;
var STD_BCK_TIMEMS = 500;

// [random_turn_0_to_90]
function stateFunction_random_turn_0_to_90_entry( smArgObj ) {
    console.log('stateFunction_random_turn_0_to_90_entry: smArgObj=' + JSON.stringify(smArgObj) + '(current rssi)');

    var rnd1 = Math.random();
    var rnd2 = Math.random();

    var timeMs = 0;

    if( rnd1 > 0.5 ) {
        timeMs = rnd2 * LEFT_TURN_360_TIME_MS/4;
        console.log('stateFunction_random_turn_0_to_90_entry: left: ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);
    } else {
        timeMs = rnd2 * RIGHT_TURN_360_TIME_MS/4;
        console.log('stateFunction_random_turn_0_to_90_entry: right: ' + timeMs);
        motor.turnright(RIGHT_TURN_DUTY, timeMs);
    }
    
    smArgObj.initialStepsOfPath = true;

    // one-shot timer callback (includes xtra time for uss to settle)
    setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+2000, smArgObj);
}
function stateFunction_random_turn_0_to_90_exit( smArgObj ) {
    console.log('stateFunction_random_turn_0_to_90_exit... smArgObj=' + JSON.stringify(smArgObj));
    // check for null only necessary in case of error event which causes us to return to poll_rssi without a smArgObj
    if( smArgObj !== null ) {
        EmptyRssiArray( smArgObj );
    }
}

// [forward]
function stateFunction_forward_entry( smArgObj ) {
    motor.forward(STD_FWD_DUTY, STD_FWD_TIMEMS);
    Reset_rssiHL();
    // for now, no extra delay to let uss settle, since we're going to linger poll to let rssi settle
    setTimeout(Delay_StateTransition_Timer, STD_FWD_TIMEMS, 'done', smArgObj);
}
function stateFunction_forward_exit( smArgObj ) {
    //console.log('stateFunction_forward_exit... smArgObj=' + JSON.stringify(smArgObj));
    reset_pollcheck_repeat_count();
}

// [poll_check_and_track_rssi]
function stateFunction_poll_check_and_track_rssi_entry( smArgObj ) {
    //console.log('stateFunction_poll_check_and_track_rssi_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    mySensorTag._peripheral.updateRssi(function (err, rssi) {
        last_rssi = rssi;
        ComputeMMA_rssi(rssi);

        mmavalue = GetMMA_rssi();
        var HILO = Get_rssiHL();

        if( mmavalue !== MMA_unknown && get_and_decr_pollcheck_rssi_repeat_count() === 0 ) {
            //console.log('RWK-pollcheck rssi: err = ' + err + 
            //            ', last_rssi = ' + last_rssi + 
            //            ', HI = ' + HILO.HI + ', LO = ' + HILO.LO +
            //            ', rssiToBeat = ' + JSON.stringify(smArgObj.rssiToBeat) );

            console.log('RWK-pollcheck:updateRssi done: smArgObj=' + JSON.stringify(smArgObj));
            console.log('RWK-pollcheck rssi: HI = ' + HILO.HI + ', LO = ' + HILO.LO );

            var rssiInt_to_check = HILO.HI;

            // filter/validate and add rssi data point to array
            var isGood = ValidatePushRssi( HILO, smArgObj );
            
            if( isGood === true ) {
                // if we're at the point of resetting the rssiToBeat, we'll pick up the current
                //   rssi data point, as long as the HI value is different than any rssiToAvoid valid
                //   we've recorded previously (this generally happens when we scan/turn to avoid an obstacle or
                //   turn 90 when we think we're moving tangentially away from the sensorTag)
                if( smArgObj.rssiToBeatStepToRESETCounter === 1 ) {
                    
                    EmptyRssiArray( smArgObj );

                    if( smArgObj.rssiToAvoid === null || smArgObj.rssiToAvoid.HI !== HILO.HI ) {
                        smArgObj.rssiToBeatStepToRESETCounter = 0;                        
                        
                        smArgObj.rssiToBeat      = HILO;
                        smArgObj.rssiToAvoid     = null; 

                        console.log('RWK-updateRssi:[rssiToBeatStepToRESETCounter === 1] resetting array and rssiToBeat - ' + JSON.stringify(HILO));
                    } else {
                        console.log('RWK-updateRssi:[rssiToBeatStepToRESETCounter === 1] not resetting: rssiToAvoid.HI ' + smArgObj.rssiToAvoid.HI + ' == HILO.HI ' + HILO.HI + ', keep moving...');
                    }

                    NextStateMachineEvent    = 'more_steps';
                    NextStateMachineEventArg = smArgObj;
                } else {
                    if( smArgObj.rssiToBeatStepToRESETCounter > 0 ) {
                        --smArgObj.rssiToBeatStepToRESETCounter;
                    }

                    if( rssiInt_to_check >= MMA_RSSI_CLOSEST ) {
                        console.log('RWK-updateRssi: reached MMA_RSSI_CLOSEST (' + MMA_RSSI_CLOSEST + ')');
                        NextStateMachineEvent    = 'rssi_is_highest';
                        NextStateMachineEventArg = null;
                    } else if( smArgObj.rssiPathArray.length < 3 ) {
                        console.log('RWK-pollcheck:COUNTING: rssiInt_to_check ' + rssiInt_to_check + ', array length = ' + smArgObj.rssiPathArray.length);
                        NextStateMachineEvent    = 'more_steps';
                        NextStateMachineEventArg = smArgObj;
                    } else {
                        var rssiDirection = DetermineRssiDirection( smArgObj );

                        if ( rssiDirection < 0 ) {
                            // moving away from senorTag
                            if( smArgObj.initialStepsOfPath === true ) {
                                console.log('RWK-pollcheck:LOWER[start of path] ... will 180: ' + JSON.stringify(HILO));
                                NextStateMachineEvent    = 'rssi_is_lower';
                                NextStateMachineEventArg = smArgObj;
                            } else {
                                // we may be moving tangentially away from the sensorTag
                                console.log('RWK-pollcheck:LOWER[middle of path] ... will 90: ' + JSON.stringify(HILO));
                                NextStateMachineEvent    = 'rssi_is_lower_after_start';
                                NextStateMachineEventArg = smArgObj;
                            }
                        } else {
                            // towards sensorTag or unclear
                            NextStateMachineEvent    = 'more_steps';
                            NextStateMachineEventArg = smArgObj;

                            if( rssiDirection > 0 ) {
                                // moving towrads sensorTag: last stopping point will now be rssiToBeat
                                smArgObj.rssiToBeat = smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 1 ];
                                console.log('RWK-pollcheck:HIGHER: rssi ' + rssiInt_to_check + ', array length = ' + smArgObj.rssiPathArray.length);
                            } else {
                                // no clear indication of direction towards or away from sensorTag
                                console.log('RWK-pollcheck:NOT SURE: rssi ' + rssiInt_to_check + ', array length = ' + smArgObj.rssiPathArray.length);
                            }

                            // start new rssi array sequence (if we keep a long array, we're bound to find 2+ with lower rssi)
                            EmptyRssiArray( smArgObj );
                        }

                        console.log( 'RWK-pollcheck: ___SET initialStepsOfPath = false ___' );
                        // we've taken at least 3 steps in a direction, so we're no longer in the initial start of a path in a particular direction
                        smArgObj.initialStepsOfPath = false;
                    }
                }
            } else {
                console.log('RWK-pollcheck:DISCARDING: HILO = ' + JSON.stringify(HILO) + ', array length = ' + smArgObj.rssiPathArray.length);
                NextStateMachineEvent    = 'more_steps';
                NextStateMachineEventArg = smArgObj;            
            }
        } else {
            //console.log('RWK-pollcheck rssi:need_more_rssi: err = ' + err + 
            //            ', last_rssi = ' + last_rssi + 
            //            ', HILO = ' + JSON.stringify(HILO) + 
            //            ', rssiToBeat = ' + JSON.stringify(smArgObj.rssiToBeat) );
            NextStateMachineEvent    = 'need_more_rssi';
            NextStateMachineEventArg = smArgObj; // cycle smArgObj to self
        }

        process.send({ rssi: last_rssi, rssiMMA: mmavalue, rssiHI: HILO.HI, rssiLO: HILO.LO });
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

    if (    typeof smArgObj  === 'undefined' || smArgObj === null
         || typeof smArgObj.rssiPathArray === 'undefined' || smArgObj.rssiPathArray === null || smArgObj.rssiPathArray.length == 0 ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        console.log('stateFunction_turn_180_entry: no smArgObj or rssiPathArray - abort');
        return;
    }

    // last stopping point will now be rssiToBeat
    smArgObj.rssiToBeat = smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 1 ];

    smArgObj.initialStepsOfPath = true;

    var TimeFor180Ms = LEFT_TURN_360_TIME_MS/2;

    motor.turnleft(LEFT_TURN_DUTY, TimeFor180Ms);

    // one-shot timer callback
    setTimeout(Delay_StateTransition_Timer, TimeFor180Ms, 'done', smArgObj );
}
function stateFunction_turn_180_exit( smArgObj ) {
    console.log('stateFunction_turn_180_exit... emptying array in smArgObj=' + JSON.stringify(smArgObj));
    if( smArgObj !== null ) {
        EmptyRssiArray( smArgObj );
    }
}

// [turn_90]
function stateFunction_turn_90_entry( smArgObj ) {
    console.log('stateFunction_turn_90_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        console.log('stateFunction_turn_90_entry: no smArgObj - abort');
        return;
    }

    // this will cause us to re-establish rssiToBeat after taking a forward step
    smArgObj.rssiToBeatStepToRESETCounter = 1;
    // setting the rssiToAvoid will also cause us to take extra steps if the rssi doesn't change, since we
    //   really want start with a different one.

    if ( typeof smArgObj.rssiPathArray !== 'undefined' && smArgObj.rssiPathArray !== null && smArgObj.rssiPathArray.length > 0 ) {
        //console.log('stateFunction_turn_90_entry: SETTING rssiToBeat ' + smArgObj.rssiToBeat.HI + ' ==> ' + smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 1 ].HI );
        // last stopping point will now be rssiToBeat
        //smArgObj.rssiToBeat = smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 1 ];

        smArgObj.rssiToAvoid = smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 1 ];
        console.log('stateFunction_turn_90_entry: SET rssiToAvoid ' + JSON.stringify(smArgObj.rssiToAvoid) );
    }
    // else, array may be empty, since we clear it ourselves when we transition back to ourself!
    

    smArgObj.initialStepsOfPath = true;

    var rnd = Math.random();

    if( smArgObj.lastTurnMode !== TURN_MODE_LEFT_90 && smArgObj.lastTurnMode !== TURN_MODE_RIGHT_90 ) {
        if( rnd > 0.5 ) {
            smArgObj.lastTurnMode = TURN_MODE_LEFT_90;
        } else {
            smArgObj.lastTurnMode = TURN_MODE_RIGHT_90;
        }
    }

    var timeMs = 0;

    var substatecount = get_and_incr_turn_90_repeat_count();
    console.log('stateFunction_turn_90_entry: substatecount = ' + substatecount );
    if( substatecount == 1 )
    {
        if( smArgObj.lastTurnMode === TURN_MODE_LEFT_90 ) {
            // left 90 degrees
            timeMs = LEFT_TURN_360_TIME_MS/4;
            console.log('stateFunction_turn_90_entry: left:[90] ' + timeMs);
            motor.turnleft(LEFT_TURN_DUTY, timeMs);
        } else {
            // left 90 degrees
            timeMs = RIGHT_TURN_360_TIME_MS/4;
            console.log('stateFunction_turn_90_entry: right:[90] ' + timeMs);
            motor.turnright(RIGHT_TURN_DUTY, timeMs);
        }

        // one-shot timer callback, last (optional) boolean indicates to randomly
        //   set 'no_obstacle_rnd' to go to 'random_turn_0_to_90' instead of 'no_obstacle' to go to 'forward'
        setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+10000, smArgObj, true);

        // reset_pollcheck_repeat_count() is called in 'forward' state before transition to poll check state
    } else if( substatecount == 2 ) {
        // left 180, which is equivalent to right [or left] 90 degrees from starting position
        timeMs = LEFT_TURN_360_TIME_MS/2;
        console.log('stateFunction_turn_90_entry: left:[180] ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);

        // one-shot timer callback, last (optional) boolean indicates to randomly
        //   set 'no_obstacle_rnd' to go to 'random_turn_0_to_90' instead of 'no_obstacle' to go to 'forward'
        setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+10000, smArgObj, true);
        
        // reset_pollcheck_repeat_count() is called in 'forward' state before transition to poll check state
    } else if( substatecount == 3 ) {
        if( smArgObj.lastTurnMode === TURN_MODE_LEFT_90 ) {
            timeMs = RIGHT_TURN_360_TIME_MS/4;
            console.log('stateFunction_turn_90_entry: right:[90] ' + timeMs);
            motor.turnright(RIGHT_TURN_DUTY, timeMs);
        } else {
            timeMs = LEFT_TURN_360_TIME_MS/4;
            console.log('stateFunction_turn_90_entry: left:[90] ' + timeMs);
            motor.turnleft(LEFT_TURN_DUTY, timeMs);
        }

        // go to 'start_escape' -- this will start the "ESCAPE" sequence, which will no longer require smArgObj, though we retain it
        //   in order to re-enter the walk (@ 'random_turn_0_to_90'), when escape states are done
        setTimeout(Delay_StateTransition_Timer, timeMs, 'double_obstacle', smArgObj);
    } else {
        console.log('stateFunction_turn_90_entry: substate error!');
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
    }
}
function stateFunction_turn_90_exit( smArgObj ) {
    console.log('stateFunction_turn_90_exit... emptying array in smArgObj=' + JSON.stringify(smArgObj));
    if( smArgObj !== null ) {
        EmptyRssiArray( smArgObj );
    }
}

// [scan_turn_90]
function stateFunction_scan_turn_90_entry( smArgObj ) {
    console.log('stateFunction_scan_turn_90_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        console.log('stateFunction_scan_turn_90_entry: no smArgObj - abort');
        return;
    }

    // this will cause us to re-establish rssiToBeat after taking a forward step
    smArgObj.rssiToBeatStepToRESETCounter = 1;
    // setting the rssiToAvoid will also cause us to take extra steps if the rssi doesn't change, since we
    //   really want start with a different one.

    if ( typeof smArgObj.rssiPathArray !== 'undefined' && smArgObj.rssiPathArray !== null && smArgObj.rssiPathArray.length > 0 ) {
        //console.log('stateFunction_scan_turn_90_entry: SETTING rssiToBeat ' + smArgObj.rssiToBeat.HI + ' ==> ' + smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 1 ].HI );
        // last stopping point will now be rssiToBeat
        //smArgObj.rssiToBeat = smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 1 ];

        smArgObj.rssiToAvoid = smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 1 ];
        console.log('stateFunction_scan_turn_90_entry: SET rssiToAvoid ' + JSON.stringify(smArgObj.rssiToAvoid) );
    }
    // else, array may be empty, since we clear it ourselves when we transition back to ourself!
    

    smArgObj.initialStepsOfPath = true;

    var rnd = Math.random();

    if( smArgObj.lastTurnMode !== TURN_MODE_LEFT_90 && smArgObj.lastTurnMode !== TURN_MODE_RIGHT_90 ) {
        if( rnd > 0.5 ) {
            smArgObj.lastTurnMode = TURN_MODE_LEFT_90;
        } else {
            smArgObj.lastTurnMode = TURN_MODE_RIGHT_90;
        }
    }

    var timeMs = 0;

    var substatecount = get_and_incr_turn_90_repeat_count();
    console.log('stateFunction_turn_90_entry: substatecount = ' + substatecount );
    if( substatecount <= 4 ) { // 1 - 4
        if( smArgObj.lastTurnMode === TURN_MODE_LEFT_90 ) {
            // left 22.5 degrees
            timeMs = LEFT_TURN_360_TIME_MS/16;
            console.log('stateFunction_turn_90_entry: left:[22.5] ' + timeMs);
            motor.turnleft(LEFT_TURN_DUTY, timeMs);
        } else {
            // left 22.5 degrees
            timeMs = RIGHT_TURN_360_TIME_MS/16;
            console.log('stateFunction_turn_90_entry: right:[22.5] ' + timeMs);
            motor.turnright(RIGHT_TURN_DUTY, timeMs);
        }

        // one-shot timer callback, last (optional) boolean indicates to randomly
        //   set 'no_obstacle_rnd' false to avoid 'random_turn_0_to_90' (i.e., normal 'no_obstacle' to go to 'forward')
        setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+10000, smArgObj, false);
    } else if( substatecount === 5 ) { // 5
        if( smArgObj.lastTurnMode === TURN_MODE_LEFT_90 ) {
            timeMs = RIGHT_TURN_360_TIME_MS/4 + RIGHT_TURN_360_TIME_MS/16;
            console.log('stateFunction_turn_90_entry: right:[90 + 22.5] ' + timeMs);
            motor.turnright(RIGHT_TURN_DUTY, timeMs);
        } else {
            timeMs = LEFT_TURN_360_TIME_MS/4 + LEFT_TURN_360_TIME_MS/16;
            console.log('stateFunction_turn_90_entry: left:[90 + 22.5] ' + timeMs);
            motor.turnleft(LEFT_TURN_DUTY, timeMs);
        }

        // one-shot timer callback, last (optional) boolean indicates to randomly
        //   set 'no_obstacle_rnd' false to avoid 'random_turn_0_to_90' (i.e., normal 'no_obstacle' to go to 'forward')
        setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+10000, smArgObj, false);
    } else if( substatecount <= 8 ) { // 6 - 8
        if( smArgObj.lastTurnMode === TURN_MODE_LEFT_90 ) {
            timeMs = RIGHT_TURN_360_TIME_MS/16;
            console.log('stateFunction_turn_90_entry: right:[22.5] ' + timeMs);
            motor.turnright(RIGHT_TURN_DUTY, timeMs);
        } else {
            timeMs = LEFT_TURN_360_TIME_MS/16;
            console.log('stateFunction_turn_90_entry: left:[22.5] ' + timeMs);
            motor.turnleft(LEFT_TURN_DUTY, timeMs);
        }

        // one-shot timer callback, last (optional) boolean indicates to randomly
        //   set 'no_obstacle_rnd' false to avoid 'random_turn_0_to_90' (i.e., normal 'no_obstacle' to go to 'forward')
        setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+10000, smArgObj, false);
    } else if( substatecount === 9 ) {
        if( smArgObj.lastTurnMode === TURN_MODE_LEFT_90 ) {
            timeMs = RIGHT_TURN_360_TIME_MS/4;
            console.log('stateFunction_scan_turn_90_entry: right:[90] ' + timeMs);
            motor.turnright(RIGHT_TURN_DUTY, timeMs);
        } else {
            timeMs = LEFT_TURN_360_TIME_MS/4;
            console.log('stateFunction_scan_turn_90_entry: left:[90] ' + timeMs);
            motor.turnleft(LEFT_TURN_DUTY, timeMs);
        }

        // go to 'start_escape' -- this will start the "ESCAPE" sequence, which will no longer require smArgObj, though we retain it
        //   in order to re-enter the walk (@ 'random_turn_0_to_90'), when escape states are done
        setTimeout(Delay_StateTransition_Timer, timeMs, 'double_obstacle', smArgObj);
    } else {
        console.log('stateFunction_scan_turn_90_entry: substate error!');
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
    }
}
function stateFunction_scan_turn_90_exit( smArgObj ) {
    console.log('stateFunction_scan_turn_90_exit... emptying array in smArgObj=' + JSON.stringify(smArgObj));
    if( smArgObj !== null ) {
        EmptyRssiArray( smArgObj );
    }
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

    smArgObj.escape_steps = 2 + rnd * 3;    // 2 to 5 steps

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
    setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+2000, smArgObj);
}
function stateFunction_escape_turn_0_to_90_exit( smArgObj ) {
    console.log('stateFunction_escape_turn_0_to_90_exit... smArgObj=' + JSON.stringify(smArgObj));
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
    
    Reset_rssiHL();

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
    uss.frontInches(CheckUSSCB_SetSMEvent, smArgObj);
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

    mySensorTag._peripheral.updateRssi(function (err, rssi) {
        last_rssi = rssi;
        ComputeMMA_rssi(rssi);

        mmavalue = GetMMA_rssi();
        var HILO = Get_rssiHL();

        if( mmavalue !== MMA_unknown && get_and_decr_pollcheck_rssi_repeat_count() === 0 ) {
            console.log('pollcheck rssi-RESTART WALK: err = ' + err + 
                        ', last_rssi = ' + last_rssi + 
                        ', HI = ' + HILO.HI + 
                        ', rssiToBeat = ' + smArgObj.rssiToBeat.HI );

            // This is not necessary here, since this will be done again in "stateFunction_random_turn_0_to_90_exit()",
            //   but, since we are setting the rssiToBeat here, we might as well clear the array to avoid any confusion.
            EmptyRssiArray( smArgObj );

            smArgObj.rssiToBeat      = HILO;
            NextStateMachineEvent    = 'done';
            NextStateMachineEventArg = smArgObj;
        } else {
            NextStateMachineEvent    = 'need_more_rssi';
            NextStateMachineEventArg = smArgObj; // cycle smArgObj to self
        }

        process.send({ rssi: last_rssi, rssiMMA: rssiMMA, rssiHI: HILO.HI, rssiLO: HILO.LO });
    });    
}
function stateFunction_poll_rssi_restart_walk_exit( smArgObj ) {
    //console.log('stateFunction_poll_rssi_restart_walk_exit... smArgObj=' + JSON.stringify(smArgObj));
}

var debug_dock_counter = 0;

// [random_walk_done]
function stateFunction_random_walk_done_entry( smArgObj ) {
    console.log('stateFunction_random_walk_done_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    NextStateMachineEvent    = 'look_for_barcode';
    NextStateMachineEventArg = null;
}
function stateFunction_random_walk_done_exit( smArgObj ) {
    //console.log('stateFunction_random_walk_done_exit... smArgObj=' + JSON.stringify(smArgObj));
    reset_turn_90_substate_count();
}

    // TODO: final docking procedure
    // do 180 degree turn and scan with barcode utility
    // if we find the barcode, move forward slowly until match_count > 2
    // use pre-tested start_stop_width for certain match_count to judge distance
    // also check x position to see if barcode is centered
    // when barcode size if max, we've docked?

// [scan_for_barcode]
function stateFunction_scan_for_barcode_entry( smArgObj ) {
    console.log('stateFunction_scan_for_barcode_entry... smArgObj=' + JSON.stringify(smArgObj));
    
    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    prepareForBarcodeCB( smArgObj );

    exec(__dirname + "/openCV_barcode_edge /dev/shm/last_edges.png -digits 1", processBarcodeResult);
}
function stateFunction_scan_for_barcode_exit( smArgObj ) {
    //console.log('stateFunction_scan_for_barcode_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [barcode_turn]
function stateFunction_barcode_turn_entry( smArgObj ) {
    console.log('stateFunction_barcode_turn_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    // turn 90 degrees right, then left in 11.5 degrees slices and recheck

    var substatecount = get_and_incr_turn_90_repeat_count();
    console.log('stateFunction_barcode_turn_entry: substatecount = ' + substatecount );

    var timeMs = 0;

    if( substatecount === 1 ) {
        // right 90 degrees
        timeMs = RIGHT_TURN_360_TIME_MS/4;
        console.log('stateFunction_barcode_turn_entry: right:[90] ' + timeMs);
        motor.turnright(RIGHT_TURN_DUTY, timeMs);

        //setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+10000, smArgObj, false);
        setTimeout(Delay_StateTransition_Timer, timeMs, 'turn_done', smArgObj );
    } else {
        if( substatecount < 17 ) {
            // turn left 11.5 degress
            timeMs = LEFT_TURN_360_TIME_MS/32;
            console.log('stateFunction_barcode_turn_entry: left:[11.5] ' + timeMs);
            motor.turnleft(LEFT_TURN_DUTY, timeMs);

            //setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+10000, smArgObj, false);
            setTimeout(Delay_StateTransition_Timer, timeMs, 'turn_done', smArgObj );
        } else {
            // we've exhausted the 180 degree field we were facing, the barcode should not be behind us, in the original orientation
            NextStateMachineEvent = 'error';
            NextStateMachineEventArg = null;
        }
    }
}
function stateFunction_barcode_turn_exit( smArgObj ) {
    //console.log('stateFunction_barcode_turn_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [barcode_center]
function stateFunction_barcode_center_entry( smArgObj ) {
    console.log('stateFunction_barcode_center_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    if ( typeof smArgObj_barcode.barcode_result  === 'undefined' || smArgObj_barcode.barcode_result === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }
    
    // From smArgObj_barcode.barcode_result.unit_width value, we can compute the total barcode pixel-width,
    //   for normal 12-digit UPC barcode as follows:
    //       total barcode pixel-width = unit_width * ( 11 + 12*7 ) = unit_width * 95
    //
    // HOWEVER, due to distance reading requirements, I decided to "blow up" a large "SINGLE-DIGIT" image containing just
    //   the lguard (bar-space-bar) + 7 bits of the 1st digit ONLY, resulting in
    //       total barcode pixel-width = unit_width * ( 3 + 1*7 ) = unit_width * 10
    //     

    // From smArgObj_barcode.barcode_result.start.x, we know where the barcode starts (0-based) in the 640 pixel-wide view.
    //      

    var barcode_pixel_width = smArgObj_barcode.barcode_result.unit_width * 10;
    var left_margin         = mArgObj_barcode.barcode_result.start.x + 1;
    var right_margin        = 640 - barcode_pixel_width - left_margin;
    var misalignment        = left_margin - right_margin;

    console.log('stateFunction_barcode_center_entry: left=' + left_margin + ', barcode_width=' + barcode_pixel_width + ', right=' + right_margin + ', misalign=' + misalignment );

    var timeMs = 0;

    if( misalignment > 2 ) {
        // right of center by more than 2 pixels (rotate slightly left)

        timeMs = LEFT_TURN_360_TIME_MS/32;
        console.log('stateFunction_barcode_center_entry: left:[11.5] ' + timeMs);
        motor.turnleft(LEFT_TURN_DUTY, timeMs);

        //setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+10000, smArgObj, true);
        setTimeout(Delay_StateTransition_Timer, timeMs, 'center_done', smArgObj );
    } else if( misalignment < -2) {
        // left of center by more than 2 pixels (rotate slightly right)
    
        timeMs = RIGHT_TURN_360_TIME_MS/32;
        console.log('stateFunction_barcode_center_entry: right:[11.5] ' + timeMs);
        motor.turnright(LEFT_TURN_DUTY, timeMs);

        //setTimeout(TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events, timeMs+10000, smArgObj, true);
        setTimeout(Delay_StateTransition_Timer, timeMs, 'center_done', smArgObj );
    } else {
        // close enough, keep going straight
        NextStateMachineEvent = 'center_done';
        NextStateMachineEventArg = smArgObj;    
    }
}
function stateFunction_barcode_center_exit( smArgObj ) {
    //console.log('stateFunction_barcode_center_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [barcode_forward]
function stateFunction_barcode_forward_entry( smArgObj ) {
    console.log('stateFunction_barcode_forward_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }
    motor.forward(STD_FWD_DUTY, STD_FWD_TIMEMS/10);
    setTimeout(Delay_StateTransition_Timer, STD_FWD_TIMEMS, 'barcode_forward_done', smArgObj);
}
function stateFunction_barcode_forward_exit( smArgObj ) {
    //console.log('stateFunction_barcode_forward_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [recheck_barcode]
function stateFunction_recheck_barcode_entry( smArgObj ) {
    console.log('stateFunction_recheck_barcode_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    prepareForBarcodeCB( smArgObj );

    exec(__dirname + "/openCV_barcode_edge /dev/shm/last_edges.png -digits 1", processBarcodeResult);

    // if no error, goto 'check_barcode_progress'
}
function stateFunction_recheck_barcode_exit( smArgObj ) {
    //console.log('stateFunction_recheck_barcode_exit... smArgObj=' + JSON.stringify(smArgObj));
    reset_turn_90_substate_count();
}

// [check_barcode_progress]
function stateFunction_check_barcode_progress_entry( smArgObj ) {
    console.log('stateFunction_check_barcode_progress_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    if ( typeof smArgObj.barcode_result === 'undefined' || smArgObj.barcode_result === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    // we should only get to this state on 'found_barcode' event, which is based on 'match_count', so there should be no need
    //   to check that we actually matched something here...

    //old: { "digits":734343525257, "match_count":12, "start":{ "x":32, "y":74 }, "stop":{ "x":565, "y":74 }, "unit_width":5, "start_stop_width":533 }

    //{ "digits":7, "match_count":1, "start":{ "x":236, "y":251 }, "stop":{ "x":376, "y":251 }, "unit_width":14, "start_stop_width":140 }
    //{ "digits":7, "match_count":1, "start":{ "x":160, "y":181 }, "stop":{ "x":468, "y":181 }, "unit_width":31, "start_stop_width":308 }
    // 4 inches away: { "digits":7, "match_count":1, "start":{ "x":70, "y":180 }, "stop":{ "x":543, "y":180 }, "unit_width":48, "start_stop_width":473, "near_code":true }

    if( smArgObj.barcode_result.near_code === true && ( smArgObj.barcode_result.unit_width > 30 || smArgObj.barcode_result.start_stop_width > 300 ) ) {
        NextStateMachineEvent = 'barcode_largest';
        NextStateMachineEventArg = smArgObj;    
    } else {
        // TBD: for now, go fwd
        NextStateMachineEvent = 'barcode_progressing';
        NextStateMachineEventArg = smArgObj;    
    }
}
function stateFunction_check_barcode_progress_exit( smArgObj ) {
    //console.log('stateFunction_check_barcode_progress_exit... smArgObj=' + JSON.stringify(smArgObj));
}

// [verify_dock]
function stateFunction_verify_dock_entry( smArgObj ) {
    console.log('stateFunction_verify_dock_entry... smArgObj=' + JSON.stringify(smArgObj));

    if ( typeof smArgObj  === 'undefined' || smArgObj === null ) {
        NextStateMachineEvent = 'error';
        NextStateMachineEventArg = null;
        return;
    }

    // spin here
    NextStateMachineEvent = 'still_charging';
    NextStateMachineEventArg = smArgObj;        
}
function stateFunction_verify_dock_exit( smArgObj ) {
    //console.log('stateFunction_verify_dock_exit... smArgObj=' + JSON.stringify(smArgObj));
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
        },
        "debug_wait": false,
        "debug_waiting": false
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
        },
        "debug_wait": false,
        "debug_waiting": false
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
        },
        "debug_wait": false,
        "debug_waiting": false
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
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'poll_rssi',
        'events':{
            'disconnect': 'disconnect',
            'poll': 'poll_rssi',
            'get_temp': 'get_temperature',
            'rnd_walk': 'random_turn_0_to_90',      // smArgObj contains current rssi (= rssi to beat)
            'test_barcode':'scan_for_barcode',
            'disconnect_success': 'idle'
        },
        'state_functions' : {
            'entry': stateFunction_poll_rssi_entry,
            'exit': stateFunction_poll_rssi_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'random_turn_0_to_90',
        'events': {
            'error': 'poll_rssi',
            'obstacle': 'random_turn_0_to_90',           // re-enter same state (theoretically could get stuck here forever)
            'no_obstacle': 'forward'
        },
        'state_functions' : {
            'entry': stateFunction_random_turn_0_to_90_entry,
            'exit': stateFunction_random_turn_0_to_90_exit
        },
        "debug_wait": false,
        "debug_waiting": false
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
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'poll_check_and_track_rssi',
        'events': {
            'error': 'poll_rssi',
            'need_more_rssi': 'poll_check_and_track_rssi',    // keep cycling to get more rssi readings
            'more_steps': 'check_uss',
            'rssi_is_lower': 'turn_180',
            'rssi_is_lower_after_start': 'turn_90',
            'rssi_is_highest': 'random_walk_done'
        },
        'state_functions' : {
            'entry': stateFunction_poll_check_and_track_rssi_entry,
            'exit': stateFunction_poll_check_and_track_rssi_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'check_uss',
        'events': {
            'error': 'poll_rssi',
            'obstacle': 'scan_turn_90',
            'no_obstacle': 'forward'
        },
        'state_functions' : {
            'entry': stateFunction_check_uss_entry,
            'exit': stateFunction_check_uss_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'turn_180',
        'events': {
            'done': 'check_uss'//'forward_n'
        },
        'state_functions' : {
            'entry': stateFunction_turn_180_entry,
            'exit': stateFunction_turn_180_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'turn_90',
        'events': {
            'error': 'poll_rssi',
            'obstacle': 'turn_90',              // re-enter same state
            'no_obstacle': 'forward',           // turned 90 degrees, now forward
            'no_obstacle_rnd': 'random_turn_0_to_90',   // turn randomly again, before forward
            'double_obstacle': 'start_escape'   // turn back in direction we came from and go backwards to restart walk
        },
        'state_functions' : {
            'entry': stateFunction_turn_90_entry,
            'exit': stateFunction_turn_90_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'scan_turn_90',
        'events': {
            'error': 'poll_rssi',
            'obstacle': 'scan_turn_90',         // re-enter same state
            'no_obstacle': 'forward',
            'double_obstacle': 'start_escape'   // turn back in direction we came from and go backwards to restart walk
        },
        'state_functions' : {
            'entry': stateFunction_scan_turn_90_entry,
            'exit': stateFunction_scan_turn_90_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'start_escape',
        'events': {
            'done': 'escape_turn_0_to_90'       // smArgObj contains random count of forward steps to take
        },
        'state_functions' : {
            'entry': stateFunction_start_escape_entry,
            'exit': stateFunction_start_escape_exit
        },
        "debug_wait": false,
        "debug_waiting": false
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
        },
        "debug_wait": false,
        "debug_waiting": false
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
        },
        "debug_wait": false,
        "debug_waiting": false
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
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'escape_turn_180',
        'events': {
            'done': 'poll_rssi_restart_walk'
        },
        'state_functions' : {
            'entry': stateFunction_escape_turn_180_entry,
            'exit': stateFunction_escape_turn_180_exit
        },
        "debug_wait": false,
        "debug_waiting": false
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
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'random_walk_done',
        'events': {
            'error': 'poll_rssi',
            'look_for_barcode': 'scan_for_barcode'
        },
        'state_functions' : {
            'entry': stateFunction_random_walk_done_entry,
            'exit': stateFunction_random_walk_done_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'scan_for_barcode',
        'events': {
            'error': 'poll_rssi',
            'no_barcode': 'barcode_turn',
            'found_barcode': 'barcode_center'
        },
        'state_functions' : {
            'entry': stateFunction_scan_for_barcode_entry,
            'exit': stateFunction_scan_for_barcode_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'barcode_turn',
        'events': {
            'error': 'poll_rssi',
            'turn_done': 'scan_for_barcode'
        },
        'state_functions' : {
            'entry': stateFunction_barcode_turn_entry,
            'exit': stateFunction_barcode_turn_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'barcode_center',
        'events': {
            'error': 'poll_rssi',
            'center_done': 'barcode_forward'
        },
        'state_functions' : {
            'entry': stateFunction_barcode_center_entry,
            'exit': stateFunction_barcode_center_exit
        },
        "debug_wait": true,
        "debug_waiting": false
    },
    {
        'name':'barcode_forward',
        'events': {
            'error': 'poll_rssi',
            'barcode_forward_done': 'recheck_barcode'
        },
        'state_functions' : {
            'entry': stateFunction_barcode_forward_entry,
            'exit': stateFunction_barcode_forward_exit
        },
        "debug_wait": true,
        "debug_waiting": false
    },
    {
        'name':'recheck_barcode',
        'events': {
            'error': 'poll_rssi',
            'no_barcode': 'poll_rssi',                  //ERROR! stop for now, couild 'barcode_forward'
            'found_barcode': 'check_barcode_progress'
        },
        'state_functions' : {
            'entry': stateFunction_recheck_barcode_entry,
            'exit': stateFunction_recheck_barcode_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'check_barcode_progress',
        'events': {
            'error': 'poll_rssi',
            'barcode_progressing': 'barcode_center',
            'barcode_largest': 'verify_dock'
        },
        'state_functions' : {
            'entry': stateFunction_check_barcode_progress_entry,
            'exit': stateFunction_check_barcode_progress_exit
        },
        "debug_wait": false,
        "debug_waiting": false
    },
    {
        'name':'verify_dock',
        'events': {
            'error': 'poll_rssi',
            'still_charging': 'verify_dock',
            'charge_done': 'poll_rssi',
            'bad_dock': 'verify_dock'           //?????????????
        },
        'state_functions' : {
            'entry': stateFunction_verify_dock_entry,
            'exit': stateFunction_verify_dock_exit
        },
        "debug_wait": true,
        "debug_waiting": false
    }
];

///////////////////////////////////////
// Global wait state control         //
///////////////////////////////////////

var GlobalIgnoreWaitStates = false;

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
            var prevStateName = this.currentState.name;

            // NOTE: currently we do allow a block(waiting) state to be transitioned away from,
            //       if a state event happens (though this should not happen with current design)

            if( this.currentState.state_functions['exit'] !== 'undefined' ) {
                // clear its waiting flag, in case it was waiting
                this.currentState.debug_waiting = false;
                // call the current state's exit function
                this.currentState.state_functions['exit']( smArgObj );
            }

            // move to next state
			this.currentState = this.states[ this.stateNameToIndex[ nextStateName ] ] ;

            if( GlobalIgnoreWaitStates === false && this.currentState.debug_wait === true ) {
                // defer transition into this state until we get a message from the parent
                this.currentState.debug_waiting = true;
                this.currentState.debug_waiting_smArgObj = smArgObj;
                // notify parent of waiting state
                process.send({ state_wait: nextStateName, previous_state: prevStateName });
            } else {
                if( this.currentState.state_functions['entry'] !== 'undefined' ) {
                    // call the new state's entry function
                    this.currentState.state_functions['entry']( smArgObj );
                }
            }
		} else {
            console.log('notifyEvent: Current: ' + this.currentState.name + ', IGNORING event: ' + SMEName );
        }
	}

    this.clearWaitingStateAndGo = function() {
        if( this.currentState.debug_waiting === true ) {
            this.currentState.debug_waiting = false;
            if( this.currentState.state_functions['entry'] !== 'undefined' ) {
                // call the new state's entry function
                this.currentState.state_functions['entry']( this.currentState.debug_waiting_smArgObj );
            }
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

//////////////////////////////////////////////
// Timer-based strobe for the State Machine //
//////////////////////////////////////////////

var clearWaitingState = false;

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
    } else if( clearWaitingState === true ) {
        clearWaitingState = false;
        sm.clearWaitingStateAndGo();
    }
}

function signalClearWaitingState() {
    clearWaitingState = true;
}

function startTimer() {
    setInterval(smStrobe, 250);
}

startTimer();

///////////////////////////////////////////////////////////
// Process Message Handler (Messages from Parent app.js) //
///////////////////////////////////////////////////////////

process.on('message', function (m) {
    console.log('CHILD v3 got message:', m);
    if (typeof m.hello !== 'undefined' && typeof m.myTag !== 'undefined') {
        if( sm.getStatus() === 'idle' ) {
            // (Note that the clearStateGenerated boolean should = false, for external command event)
            var smArgObj = { tagUUID: m.myTag };
            sm.notifyEvent('start', false, smArgObj);
        }
    } else if( m.command !== 'undefined' ) {
        if( m.command === 'get_temp' ) {
            // since javascript and node.js is single threaded, we won't
            //   need to mutex access to these globals
            CommandGeneratedEvent = 'get_temp';
            CommandGeneratedEventArg = null;
        } else if( m.command === 'random_walk' ) {
            // (Note that the clearStateGenerated boolean should = false, for external command event)
            if( GetMMA_rssi() !== MMA_unknown ) {
                var HILO = Get_rssiHL();
                var smArgObj = { tagUUID: mySensorTag.uuid.toLowerCase(),
                                 rssiToBeat: HILO,
                                 rssiToAvoid: null,
                                 rssiToBeatStepToRESETCounter: 0,
                                 lastTurnMode: TURN_MODE_UNKNOWN,
                                 initialStepsOfPath: true,
                                 rssiPathArray: [] };
                CommandGeneratedEvent = 'rnd_walk';
                CommandGeneratedEventArg = smArgObj;
            } else {
                console.log('cannot start random walk, due to not having initial rssi');
            }
        } else if( m.command === 'test_barcode' ) {
            // need a placeholder obj to hold barcode results
            var smArgObj;
            if( GetMMA_rssi() !== MMA_unknown ) {
                var HILO = Get_rssiHL();
                smArgObj = { tagUUID: mySensorTag.uuid.toLowerCase(),
                             rssiToBeat: HILO,
                             rssiToAvoid: null,
                             rssiToBeatStepToRESETCounter: 0,
                             lastTurnMode: TURN_MODE_UNKNOWN,
                             initialStepsOfPath: true,
                             rssiPathArray: [] };
            } else {
                smArgObj = { tagUUID: null,
                             rssiToBeat: null,
                             rssiToAvoid: null,
                             rssiToBeatStepToRESETCounter: 0,
                             lastTurnMode: TURN_MODE_UNKNOWN,
                             initialStepsOfPath: true,
                             rssiPathArray: [] };
            }
            CommandGeneratedEvent = 'test_barcode';
            CommandGeneratedEventArg = smArgObj;
        } else if( m.command === 'reset_rssiHL' ) {
            // TEST (this message is sent by parent when it activates motor controls based on web client page activity):
            Reset_rssiHL();
        } else if( m.command === 'end_wait' ) {
            signalClearWaitingState();
        } else if( m.command === 'disable_waits' ) {
            GlobalIgnoreWaitStates = true;
        } else if( m.command === 'enable_waits' ) {
            GlobalIgnoreWaitStates = false;
        }
    }
});

process.send({ foo: 'bar' });

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

function TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events(smArgObj, boolUseRnd) {
    console.log('TurnWaitTimerCB_Check_USS_and_Set_SM_Obstacle_Events: boolUseRnd = ' + boolUseRnd + '... calling uss.frontInches() - smArgObj = ' + smArgObj);
    // check ultrasonic after turn completes, and set event to go to next state
    if( boolUseRnd === true ) {
        uss.frontInches(CheckUSSCB_SetSMEvent_Rnd, smArgObj);
    } else {
        uss.frontInches(CheckUSSCB_SetSMEvent, smArgObj);
    }
}

function CheckUSSCB_SetSMEvent_Rnd(distanceFloat, smArgObj) {
    if( distanceFloat > 9.0 ) {
        console.log('CheckUSSCB_SetSMEvent_Rnd: ' + distanceFloat + ' inches, ' + JSON.stringify(smArgObj) + ' _____ CLEAR _____');
        
        smArgObj.obstacle        = false;

        var rnd = Math.random();
        if( rnd > 0.9 ) {
            NextStateMachineEvent    = 'no_obstacle_rnd';
        } else {
            NextStateMachineEvent    = 'no_obstacle';
        }
        NextStateMachineEventArg = smArgObj; //forward the previous rssi        
    } else {
        console.log('CheckUSSCB_SetSMEvent_Rnd: ' + distanceFloat + ' inches, ' + JSON.stringify(smArgObj) + '#_#_#_#_# BLOCKED #_#_#_#_#');
        smArgObj.obstacle        = true;
        NextStateMachineEvent    = 'obstacle';
        NextStateMachineEventArg = smArgObj; //pass along rssi to self
    }
}

function CheckUSSCB_SetSMEvent(distanceFloat, smArgObj) {
    if( distanceFloat > 9.0 ) {
        console.log('CheckUSSCB_SetSMEvent: ' + distanceFloat + ' inches, ' + JSON.stringify(smArgObj) + ' _____ CLEAR _____');
        smArgObj.obstacle        = false;
        NextStateMachineEvent    = 'no_obstacle';
        NextStateMachineEventArg = smArgObj; //forward the previous rssi        
    } else {
        console.log('CheckUSSCB_SetSMEvent: ' + distanceFloat + ' inches, ' + JSON.stringify(smArgObj) + '#_#_#_#_# BLOCKED #_#_#_#_#');
        smArgObj.obstacle        = true;
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
    console.log('___EmptyRssiArray - smArgObj = ' + JSON.stringify( smArgObj ) );
    while(smArgObj.rssiPathArray.length > 0) {
        smArgObj.rssiPathArray.pop();
    }
}

//////////////////////////////////////////////////

var MMA_RSSI_CLOSEST = -60;//-59;

var MMA_rssi    = 0;
var MMA_n       = 6;
var MMA_count   = 0;
var MMA_unknown = -1000.0;

var INVALID_RSSI_HIGH   = -1000;
var INVALID_RSSI_LOW    = 0;

var rssi_HIGH           = INVALID_RSSI_HIGH;
var rssi_LOW            = INVALID_RSSI_LOW;

function ComputeMMA_rssi(rssi) {
    MMA_rssi = ( (MMA_n - 1) * MMA_rssi + rssi ) / MMA_n;
    MMA_count++;

    //console.log('compare rssi = ' + rssi + ' to rssi_HIGH = ' + rssi_HIGH );
    if( rssi > rssi_HIGH ) {
        rssi_HIGH = rssi;
    }

    //console.log('compare rssi = ' + rssi + ' to rssi_LOW = ' + rssi_LOW );
    if( rssi < rssi_LOW ) {
        rssi_LOW = rssi;
    }
}

function GetMMA_rssi() {
    if(MMA_count > MMA_n) {
        return MMA_rssi;
    }
    return MMA_unknown;
}

function Reset_rssiHL() {
    rssi_HIGH = INVALID_RSSI_HIGH;
    rssi_LOW  = INVALID_RSSI_LOW;
    console.log('Reset_rssiHL() - ' + rssi_HIGH + ', ' + rssi_LOW );
}

function Get_rssiHL() {
    return { HI: rssi_HIGH, LO: rssi_LOW };
}

//////////////////////////////////////////////////

var DEAD_SPOT_THRESHOLD     = 4;
var STRONG_SPOT_THRESHOLD   = 4;

var RSSI_POINTS_NEEDED      = 3;
var RSSI_MIN_VOTES          = 2;

// \returns  1  if rssi appears stronger
//           0  if rssi direction cannot be determined
//          -1  if rssi appears weaker
function DetermineRssiDirection( smArgObj ) {
    // check for at least 2 data points where rssi is lower than smArgObj.rssiToBeat
    
    if( smArgObj.rssiPathArray.length < RSSI_POINTS_NEEDED ) {
        return 0;
    }

    var lowvotes = 0;
    var highvotes = 0;

    for	(index = 0; index < smArgObj.rssiPathArray.length; ++index) {
        console.log( 'DetermineRssiDirection: comparing HI ' + smArgObj.rssiPathArray[index].HI + ' < rssiToBeat ' + smArgObj.rssiToBeat.HI + ' ?' );

        // current point can be considered against the "origin" (rssiToBeat),
        //   if delta from one neighbor (prev or next) is < DEAD_SPOT_THRESHOLD

        // preliminary delta determination

        var prev_rssi;
        if( index === 0 ) {
            prev_rssi = smArgObj.rssiToBeat;
        } else {
            prev_rssi = smArgObj.rssiPathArray[ index - 1 ];
        }
            
        var next_rssi;
        if( index < ( smArgObj.rssiPathArray.length - 1 ) )
        {
            next_rssi = smArgObj.rssiPathArray[ index + 1 ];
        } else {
            next_rssi = { HI: INVALID_RSSI_HIGH, LO: INVALID_RSSI_LOW };
        }

        var delta_prev;
        if( prev_rssi.HI > smArgObj.rssiPathArray[index].HI ) {
            delta_prev = prev_rssi.HI - smArgObj.rssiPathArray[index].HI;
        } else {
            delta_prev = smArgObj.rssiPathArray[index].HI - prev_rssi.HI;
        }

        var delta_next;
        if( next_rssi.HI > smArgObj.rssiPathArray[index].HI ) {
            delta_next = next_rssi.HI - smArgObj.rssiPathArray[index].HI;
        } else {
            delta_next = smArgObj.rssiPathArray[index].HI - next_rssi.HI;        
        }

        if( delta_prev < DEAD_SPOT_THRESHOLD || delta_next < DEAD_SPOT_THRESHOLD ) {
            
            if( smArgObj.rssiPathArray[index].HI < smArgObj.rssiToBeat.HI ) {
                if( ++lowvotes >= RSSI_MIN_VOTES ) {
                    console.log( 'DetermineRssiDirection: return -1 [DECREASING]' );
                    return -1;
                }
            }

            if( smArgObj.rssiPathArray[index].HI > smArgObj.rssiToBeat.HI ) {
                if( ++highvotes >= RSSI_MIN_VOTES ) {
                    console.log( 'DetermineRssiDirection: return +1 [INCREASING]' );
                    return 1;
                }
            }

        }
    }

    console.log( 'DetermineRssiDirection: return 0 [UNDETERMINED]' );
    return 0;
}

function ValidatePushRssi( HILO, smArgObj ) {
    // ---------------------------------------------------
    // -- discard legit looking weak point ("deadspot") --
    // ---------------------------------------------------

    var prev_rssi;
    var prev_rssi_in_array = true;

    if( smArgObj.rssiPathArray.length <= 0 ) {
        prev_rssi = smArgObj.rssiToBeat;
        prev_rssi_in_array = false;
    } else {
        prev_rssi = smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 1 ];
    }

    if( prev_rssi.HI > HILO.HI && prev_rssi.LO > HILO.LO ) {
        HILO.drop = true;
    } else if ( prev_rssi.HI < HILO.HI && prev_rssi.LO < HILO.LO ) {
        HILO.rise = true;
    }

    //if( prev_rssi.HI > HILO.HI && ( ( prev_rssi.HI - HILO.HI ) >= DEAD_SPOT_THRESHOLD ) && prev_rssi.LO > HILO.LO ) {
        // arriving at deadspot
        // discard current point (don't push)
    //    return false; // return false if we discard anything
    //} else
    if ( prev_rssi.HI < HILO.HI && ( ( HILO.HI - prev_rssi.HI ) >= DEAD_SPOT_THRESHOLD ) && prev_rssi.LO < HILO.LO ) {
        // leaving deadspot
        // discard previous point, while keeping the current point
        if( prev_rssi_in_array !== true ) {
            // if a drop was detected when this rssiToBeat was recorded
            if( typeof smArgObj.rssiToBeat.drop !== 'undefined' && smArgObj.rssiToBeat.drop === true ) {
                // now, we know there was a drop entering and leaving the rssiToBeat, so replace it with our current data point
                console.log('ValidatePushRssi:LEAVING DEADSPOT in rssiToBeat(drop=true): overwrite ' + smArgObj.rssiToBeat.HI + ' with ' + HILO.HI);
                smArgObj.rssiToBeat = HILO;
            }
        } else {
            var prev_prev_rssi;

            if( smArgObj.rssiPathArray.length > 1 ) {
                prev_prev_rssi = smArgObj.rssiPathArray[ smArgObj.rssiPathArray.length - 2 ];
            } else {
                prev_prev_rssi = smArgObj.rssiToBeat;
            }

            // validate "spot" (single point) of signal weakness (i.e. prev_rssi is lower than current and also lower than point before that)
            if ( prev_rssi.HI < prev_prev_rssi.HI ) {
                
                var popped = smArgObj.rssiPathArray.pop();

                console.log('ValidatePushRssi:LEAVING DEADSPOT in rssiPathArray: popped = ' + popped.HI + ', pushed = ' + HILO.HI + ', prev_prev_rssi.HI = ' + prev_prev_rssi.HI );

                // push current point to end of array
                smArgObj.rssiPathArray.push( HILO );

                return false; // return false if we discard anything
            } else {
                // previous point is not considered a deadspot since the spot previous to that did not have a stronger signal
                console.log('ValidatePushRssi:LEAVING weakspot in rssiPathArray:result after push: ' + prev_prev_rssi.HI + ' ' + prev_rssi.HI + ' ' + HILO.HI );
            }
        }
    }

    // ---------------------------------------------
    // -- discard abnormally looking strong point --
    // ---------------------------------------------

    if( prev_rssi.HI > HILO.HI && ( ( prev_rssi.HI - HILO.HI ) >= STRONG_SPOT_THRESHOLD ) && prev_rssi.LO < HILO.LO ) {
        // leaving abnormal looking strong point
        // discard previous point
        if( prev_rssi_in_array === true ) {
            console.log('ValidatePushRssi:LEAVING HOTSPOT in rssiPathArray: prev = ' + prev_rssi.HI + ' current = ' + HILO.HI);
            smArgObj.rssiPathArray.pop();
            // push current point to end of array
            smArgObj.rssiPathArray.push( HILO );
        } else {
            console.log('ValidatePushRssi:LEAVING HOTSPOT in rssiToBeat: prev = ' + prev_rssi.HI + ' current = ' + HILO.HI);
            // previous was in rssiToBeat (array must be empty), just overwrite rssiToBeat with current point
            smArgObj.rssiToBeat = HILO;
        }
        return false; // return false if we discard anything
    } else if ( prev_rssi.HI < HILO.HI && ( ( HILO.HI - prev_rssi.HI ) >= STRONG_SPOT_THRESHOLD ) && prev_rssi.LO > HILO.LO ) {
        // arriving at abnormal looking strong point
        // discard current point (don't push)
        console.log('ValidatePushRssi:ARRIVING HOTSPOT: prev = ' + prev_rssi.HI + ', current = ' + HILO.HI);
        return false; // return false if we discard anything
    }

    console.log('ValidatePushRssi:PUSHING: current = ' + HILO.HI);
    // if we make it here, we're keeping the point and returning true
    smArgObj.rssiPathArray.push( HILO );
    return true;
}

//////////////////////////////////////////////////

var DEFAULT_POLLCHECK_REPEAT_WAITCOUNT = 40
var pollcheck_rssi_repeat_count;

function reset_pollcheck_repeat_count() {
    pollcheck_rssi_repeat_count = DEFAULT_POLLCHECK_REPEAT_WAITCOUNT;
    console.log('reset_pollcheck_repeat_count: set to ' + pollcheck_rssi_repeat_count);
}

function get_and_decr_pollcheck_rssi_repeat_count() {
    //console.log('get_and_decr_pollcheck_rssi_repeat_count: count = ' + pollcheck_rssi_repeat_count);
    if( pollcheck_rssi_repeat_count > 0 ) {
        var retval = pollcheck_rssi_repeat_count;
        pollcheck_rssi_repeat_count = pollcheck_rssi_repeat_count - 1;
        //console.log('get_and_decr_pollcheck_rssi_repeat_count: returning ' + retval + ', decremented count = ' + pollcheck_rssi_repeat_count);
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
    return ++turn_90_substate_count;
}

///////////////////////////////////////////////////

var smArgObj_barcode = null;

function prepareForBarcodeCB( smArgObj ) {
    smArgObj_barcode = smArgObj;
}

function processBarcodeResult(error, stdout, stderr) {
    var errorDetected = true;

    if (typeof stdout !== 'undefined' && stdout !== null) {
        try {
            var barcode_result = JSON.parse(stdout);

            // keep running tally of current barcode detection result and previous result

            if (typeof smArgObj_barcode.barcode_result !== 'undefined' ) {
                smArgObj_barcode.barcode_prev_result = smArgObj_barcode.barcode_result;
            } else {
                smArgObj_barcode.barcode_prev_result = null;
            }

            smArgObj_barcode.barcode_result = barcode_result;

            if (barcode_result.match_count > 0) {
                console.log('processBarcodeResult:BARCODE-RESULT: match_count = ' + barcode_result.match_count);
                //console.log('BARCODE RESULT: ' + JSON.stringify(barcode_result));

                NextStateMachineEvent    = 'found_barcode';
                NextStateMachineEventArg = smArgObj_barcode;
            } else {
                NextStateMachineEvent    = 'no_barcode';
                NextStateMachineEventArg = smArgObj_barcode;
            }

            errorDetected = false;
        }
        catch (err) {
            console.log('BARCODE RESULT PARSE ERROR: error = ' + error + ', stdout = ' + stdout);
        }
    }

    // try it again, if error
    if( errorDetected === true ) {
        exec(__dirname + "/openCV_barcode_edge /dev/shm/last_edges.png -digits 1", processBarcodeResult);
    }
}
