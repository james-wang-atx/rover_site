var bone = require('bonescript');

function doNothing() {
}

function P8_13_Off() {
    bone.analogWrite('P8_13', 0, 2000, doNothing);
}

function P8_19_Off() {
    bone.analogWrite('P8_19', 0, 2000, doNothing);
}

function P9_14_Off() {
    bone.analogWrite('P9_14', 0, 2000, doNothing);
}

function P9_16_Off() {
    bone.analogWrite('P9_16', 0, 2000, doNothing);
}

var MAX_MOTOR_RUN_MS = 3000;
var DEFAULT_TIMEOUT_MS = 500;
var DEFAULT_DUTY = 0.2;

function schedule_P8_13_Off(data) {
    //console.log('schedule_P8_13_Off:data=' + JSON.stringify(data));

    var timeout = data.userdata;
    if (timeout <= 0 || timeout > MAX_MOTOR_RUN_MS) {
        timeout = DEFAULT_TIMEOUT_MS;
    }

    console.log('req timeout = ' + timeout);
    setTimeout(P8_13_Off, timeout);
}

function schedule_P8_19_Off(data) {
    var timeout = data.userdata;
    if (timeout <= 0 || timeout > MAX_MOTOR_RUN_MS) {
        timeout = DEFAULT_TIMEOUT_MS;
    }

    console.log('req timeout = ' + timeout);
    setTimeout(P8_19_Off, timeout);
}

function schedule_P9_14_Off(data) {
    var timeout = data.userdata;
    if (timeout <= 0 || timeout > MAX_MOTOR_RUN_MS) {
        timeout = DEFAULT_TIMEOUT_MS;
    }

    console.log('req timeout = ' + timeout);
    setTimeout(P9_14_Off, timeout);
}

function schedule_P9_16_Off(data) {
    //console.log('schedule_P9_16_Off:data=' + JSON.stringify(data));

    var timeout = data.userdata;
    if (timeout <= 0 || timeout > MAX_MOTOR_RUN_MS) {
        timeout = DEFAULT_TIMEOUT_MS;
    }

    console.log('req timeout = ' + timeout);
    setTimeout(P9_16_Off, timeout);
}

// range check between 0.0 and 1.0
function validateDuty(duty) {
    if (duty <= 0.0 || duty > 1.0) {
        return DEFAULT_DUTY;
    }
    return duty;
}

var forward = function (reqDutyFloat, reqTimeMs) {
    P9_14_Off();
    P8_19_Off();

    var duty = validateDuty(reqDutyFloat);
    var duty2 = validateDuty(reqDutyFloat - 0.2);

    bone.analogWriteEx('P9_16', duty2, 2000, schedule_P9_16_Off, reqTimeMs); //Left side fwd
    bone.analogWriteEx('P8_13', duty, 2000, schedule_P8_13_Off, reqTimeMs);  //Right side fwd
};

var reverse = function (reqDutyFloat, reqTimeMs) {
    P9_16_Off();
    P8_13_Off();

    var duty = validateDuty(reqDutyFloat);
    var duty2 = validateDuty(reqDutyFloat - 0.2);

    bone.analogWriteEx('P9_14', duty2, 2000, schedule_P9_14_Off, reqTimeMs); //Left side back
    bone.analogWriteEx('P8_19', duty, 2000, schedule_P8_19_Off, reqTimeMs);  //Right side back
};

var turnleft = function (reqDutyFloat, reqTimeMs) {
    P9_16_Off();
    P8_19_Off();

    var duty = validateDuty(reqDutyFloat);

    bone.analogWriteEx('P9_14', duty, 2000, schedule_P9_14_Off, reqTimeMs); //Left side back
    bone.analogWriteEx('P8_13', duty, 2000, schedule_P8_13_Off, reqTimeMs); //Right side fwd
};

var turnright = function (reqDutyFloat, reqTimeMs) {
    P9_14_Off();
    P8_13_Off();

    var duty = validateDuty(reqDutyFloat);

    bone.analogWriteEx('P9_16', duty, 2000, schedule_P9_16_Off, reqTimeMs); //Left side fwd
    bone.analogWriteEx('P8_19', duty, 2000, schedule_P8_19_Off, reqTimeMs); //Right side back
};

module.exports = {
    forward:   forward,
    reverse:   reverse,
    turnleft:  turnleft,
    turnright: turnright
};
