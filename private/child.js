var fs = require('/usr/lib/node_modules/fs-ext/fs-ext.js');
var bone = require('bonescript');
var noble = require('noble');
var SensorTag = require('sensortag');

var discoveryInProgress = false;
var MY_SENSOR_TAG_UUID = '9059af0b834a';
var mySensorTag = null;

process.on('message', function (m) {
    console.log('CHILD got message:', m);
    if (typeof m.hello != 'undefined' && typeof m.myTag != 'undefined') {
        if ( discoveryInProgress === false && mySensorTag === null) {
            DiscoverSensorTag(m.myTag);
        }
    } else {
        console.log('CHILD: no sensor tag UUID given by parent');
    }
});

process.send({ foo: 'bar' });

function DiscoverSensorTag(tagUUID) {
    discoveryInProgress = true;
    SensorTag.discover(function (sensorTag) {
        console.log('SensorTag.discover: sensorTag = ' + sensorTag);

        // defer this till connected?
        mySensorTag = sensorTag;

        if (sensorTag.uuid.toLowerCase() === MY_SENSOR_TAG_UUID) {
            console.log('found my sensortag!');

            sensorTag.connect(function () {
                console.log('connected to sensortag!');

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
            });
        }

        discoveryInProgress = false;
    }, tagUUID
    );
};