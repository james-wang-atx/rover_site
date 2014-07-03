var bone = require('bonescript');

//////////////////////////////////////////////////////////////////

var pendingUSSFront_callbacks = [];

function ussFrontConvertToInches(x) {
    if ( isNaN( x.value ) ) {
        //console.log('ussFrontConvertToInches:NaN [calling again] x = ' + JSON.stringify(x));
        bone.analogRead('P9_40', ussFrontConvertToInches);
        return;
    }

    var distanceInches;

    analogVoltage = x.value * 1.8; // ADC Value converted to voltage

    //1.8v/512 = 0.003515625
    distanceInches = analogVoltage / 0.003515625;

    //LastFrontUSSReading = '' + parseFloat(distanceInches).toFixed(3);
    while (pendingUSSFront_callbacks.length > 0) {
        cbinfo  = pendingUSSFront_callbacks.pop();
        cbinfo.callback(distanceInches, cbinfo.arg);
    }
}

var frontInches = function (usercallback, userarg) {
    var cbinfo = { callback: usercallback, arg: userarg };
    pendingUSSFront_callbacks.push(cbinfo);
    if (pendingUSSFront_callbacks.length == 1) {
        bone.analogRead('P9_40', ussFrontConvertToInches);
    }
};

/////////////////////////////////////////////////////////////////

var pendingUSSRear_callbacks = [];

function ussRearConvertToInches(x) {
    if ( isNaN( x.value ) ) {
        //console.log('ussRearConvertToInches:NaN [calling again] x = ' + JSON.stringify(x));
        bone.analogRead('P9_38', ussRearConvertToInches);
        return;
    }

    var distanceInches;
    analogVoltage = x.value * 1.8; // ADC Value converted to voltage

    //1.8v/512 = 0.003515625
    distanceInches = analogVoltage / 0.003515625;

    while (pendingUSSRear_callbacks.length > 0) {
        cbinfo  = pendingUSSRear_callbacks.pop();
        cbinfo.callback(distanceInches, cbinfo.arg);
    }
}

var rearInches = function (usercallback, userarg) {
    var cbinfo = { callback: usercallback, arg: userarg };
    pendingUSSRear_callbacks.push(cbinfo);
    if (pendingUSSRear_callbacks.length == 1) {
        bone.analogRead('P9_38', ussRearConvertToInches);
    }
};

module.exports = {
    frontInches: frontInches,
    rearInches:  rearInches
};
