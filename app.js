/*
 * Module dependencies
 */
var express = require('express');
var stylus  = require('stylus');
var nib     = require('nib');
var http    = require('http');
var fs      = require('/usr/lib/node_modules/fs-ext/fs-ext.js');
var bone    = require('bonescript');
var sys     = require('sys');
var cp      = require('child_process');
var exec    = cp.exec;

bone.pinMode("USR3", bone.OUTPUT);
var whichButton = 'USR3';

bone.pinMode('P9_14', bone.OUTPUT);
bone.pinMode('P9_16', bone.OUTPUT);
bone.pinMode('P8_13', bone.OUTPUT);
bone.pinMode('P8_19', bone.OUTPUT);

var app = express()

function compile(str, path) {
  return stylus(str)
    .set('filename', path)
    .use(nib())
}

app.set('pretty', 'true');
app.set('port', process.env.PORT || 4000);
app.set('views', __dirname + '/views')
app.set('view engine', 'jade')
app.use(express.logger('dev'))

app.use(express.bodyParser());

// use middleware stylus, giving it it's home directory and custom compile function (+nib)
app.use(stylus.middleware(
  { src: __dirname + '/public'
  , compile: compile
  }
))

// static file requests go to this directory
app.use(express.static(__dirname + '/public'))

var temperature = { object: '', ambient: '' };

var LastFrontUSSReading = '';
var LastRearUSSReading = '';

function UpdateUSStatusFront(x) {
    var distanceInches;
    analogVoltage = x.value*1.8; // ADC Value converted to voltage
    //console.log('FRONT: x.value = ' + x.value + ', analogVoltage = ' + analogVoltage); 
    
    distanceInches = analogVoltage / 0.003515625;
    
    //console.log("There is an object " +
    //parseFloat(distanceInches).toFixed(3) + " inches away.");

    LastFrontUSSReading = '' + parseFloat(distanceInches).toFixed(3);
}

function UpdateUSStatusRear(x) {
    var distanceInches;
    analogVoltage = x.value*1.8; // ADC Value converted to voltage
    //console.log('REAR: x.value = ' + x.value + ', analogVoltage = ' + analogVoltage); 
    
    distanceInches = analogVoltage / 0.003515625;
    
    //console.log("There is an object " +
    //parseFloat(distanceInches).toFixed(3) + " inches away.");

    LastRearUSSReading = '' + parseFloat(distanceInches).toFixed(3);
}

function updateUltrasonics() {
    //front
    bone.analogRead('P9_40', UpdateUSStatusFront);
    //rear
    bone.analogRead('P9_38', UpdateUSStatusRear);
}

app.get('/uss/rear', function (req, res) {
  //console.log('/uss - req.url=' + req.url);

  res.set({
    'Content-Type': 'text/plain'
  });

  res.writeHead(200);
  res.write(LastRearUSSReading);  

  res.end();
})

app.get('/uss/front', function (req, res) {
  //console.log('/uss - req.url=' + req.url);

  res.set({
      'Content-Type': 'text/plain'
  });

  res.writeHead(200);
  res.write(LastFrontUSSReading);  
  res.end();
})

var last_rssi = 'unknown';
var last_object_temperature = 'unknown';
var last_ambient_temperature = 'unknown';

app.get('/bt/rssi', function (req, res) {

    res.set({
        'Content-Type': 'text/plain'
    });

    res.writeHead(200);
    res.write(last_rssi);
    res.end();
})

var outstanding_response = null;

// route root request to render 'index' view, with 'title' argument passed to view engine (jade)
app.get('/rover', function (req, res) {

    console.log('/rover - req.url=' + req.url);

    if (req.url == "/rover?ledbutton=on") {
        console.log('ON REQ');
        bone.digitalWrite(whichButton, bone.HIGH);
        res.writeHead(204);
        res.end();
    }
    else if (req.url == "/rover?ledbutton=off") {
        console.log('OFF REQ');
        bone.digitalWrite(whichButton, bone.LOW);
        res.writeHead(204);
        res.end();
    }
    else if (req.url == "/rover?gettemp=true") {
        console.log('GET TEMPERATURE');

        n.send({ command: 'get_temp' });

        outstanding_response = res;
    }
    else {
        res.render('index', { title: 'Security and Safety Rover' })
    }
})



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

var MAX_MOTOR_RUN_MS    = 3000;
var DEFAULT_TIMEOUT_MS  = 500;
var DEFAULT_DUTY        = 0.2;

function schedule_P8_13_Off( data ) {
    //console.log('schedule_P8_13_Off:data=' + JSON.stringify(data));

    var timeout = data.userdata;
    if (timeout <= 0 || timeout > MAX_MOTOR_RUN_MS) {
        timeout = DEFAULT_TIMEOUT_MS;
    }

    console.log('req timeout = ' + timeout);
    setTimeout(P8_13_Off, timeout);
}

function schedule_P8_19_Off( data ) {
    var timeout = data.userdata;
    if (timeout <= 0 || timeout > MAX_MOTOR_RUN_MS) {
        timeout = DEFAULT_TIMEOUT_MS;
    }

  console.log('req timeout = ' + timeout);
  setTimeout(P8_19_Off, timeout);
}

function schedule_P9_14_Off( data ) {
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

// movement control request
app.post('/control*', function (req, res) {
    console.log('POST req.url=' + req.url);
    console.log(req.body);

    if (req.url == "/control?dir=FWD") {
        P9_14_Off();
        P8_19_Off();

        //console.log('req.body.FTIME = ' + req.body.FTIME);
        //console.log('req.body.FDUTY = ' + req.body.FDUTY);

        var duty  = validateDuty(req.body.FDUTY);
        var duty2 = validateDuty(duty - 0.2);

        console.log('duty = ' + duty + ', duty2 = ' + duty2);

        //        bone.analogWriteEx('P9_16', duty, 2000, schedule_P9_16_Off, req.body.FTIME); //Left side fwd
        //        bone.analogWriteEx('P8_13', duty, 2000, schedule_P8_13_Off, req.body.FTIME); //Right side fwd

        bone.analogWriteEx('P9_16', duty2, 2000, schedule_P9_16_Off, req.body.FTIME); //Left side fwd
        bone.analogWriteEx('P8_13', duty, 2000, schedule_P8_13_Off, req.body.FTIME); //Right side fwd

    } else if (req.url == "/control?dir=BCK") {
        P9_16_Off();
        P8_13_Off();

        // duty cycle percentabe must be between 0 and 1
        var duty  = validateDuty(req.body.BDUTY);
        var duty2 = validateDuty(duty - 0.2);

        console.log('req. duty = ' + duty);
        bone.analogWriteEx('P9_14', duty2, 2000, schedule_P9_14_Off, req.body.BTIME); //Left side back
        bone.analogWriteEx('P8_19', duty, 2000, schedule_P8_19_Off, req.body.BTIME);  //Right side back
    } else if (req.url == "/control?dir=LFT") {
        P9_16_Off();
        P8_19_Off();

        // duty cycle percentabe must be between 0 and 1
        var duty = validateDuty(req.body.LDUTY);

        console.log('req. duty = ' + duty);
        bone.analogWriteEx('P9_14', duty, 2000, schedule_P9_14_Off, req.body.LTIME); //Left side back
        bone.analogWriteEx('P8_13', duty, 2000, schedule_P8_13_Off, req.body.LTIME); //Right side fwd
    } else if (req.url == "/control?dir=RGT") {
        P9_14_Off();
        P8_13_Off();

        // duty cycle percentabe must be between 0 and 1
        var duty = validateDuty(req.body.RDUTY);

        console.log('req. duty = ' + duty);
        bone.analogWriteEx('P9_16', duty, 2000, schedule_P9_16_Off, req.body.RTIME); //Left side fwd
        bone.analogWriteEx('P8_19', duty, 2000, schedule_P8_19_Off, req.body.RTIME); //Right side back
    }

    res.writeHead(204);
    res.end();
})

// 'sh' == LOCK_SH == Shared lock (for reading)
// 'ex' == LOCK_EX == Exclusive lock (for writing)
// 'nb' == LOCK_NB == Non-blocking request
// 'un' == LOCK_UN == Free the lock
// 'shnb' == LOCK_SH | LOCK_NB
// 'exnb' == LOCK_EX | LOCK_NB
app.get('/snapshot', function (req, res) {
  var fd = fs.openSync(__dirname + '/private/snapshot.lockfile', 'r');

  updateUltrasonics();

  fs.flock(fd, 'sh', function (err) {
    if (err) {
      console.log("---------> Couldn't lock file");
      res.writeHead(500);
      res.end();
    }
    else
    {
      // file is locked
      //console.log('LOCKED...');

      var LastModifiedDate;

      fs.stat(__dirname + '/private/last_outputHD.jpg', function (err, stats) {
        if (!err)
        {
          //console.log('stats.mtime ' + stats.mtime);
          LastModifiedDate = new Date(Date.parse(stats.mtime));
        }
      });

      // file is locked
      fs.readFile(__dirname + '/private/last_outputHD.jpg', function (err, data) {
        if (err)
        {
          res.writeHead(404);
          res.end();
        }
        else if(data.length == 0)
        {
          res.writeHead(304);
          res.end();
        }
        else
        {
          if(typeof LastModifiedDate === 'undefined')
          {
            res.writeHead(200, {'Content-Type': 'image/jpeg',
                                'Content-Length': data.length});
          }
          else
          {
            res.writeHead(200, {'Content-Type': 'image/jpeg',
                                'Content-Length': data.length,
                                'Last-Modified': LastModifiedDate.toString()}); //RFC2822 string
          }
          res.write(data);
          res.end();
        }
      });
    }

    fs.flock(fd, 'un', function (err) {
      if (err) {
          console.log("---------> Couldn't unlock file");
      }
      else
      {
          //console.log('UNLOCKED...');
      }
    })

    fs.closeSync(fd);
  })

})

///////////////////////////
// Startup the webserver //
///////////////////////////

var server = http.createServer(app);

server.listen(app.get('port'), function () {
    console.log('Express server listening on port ' + app.get('port'));
    process.title = 'rover_site';
});

//////////////////////////////////////////////////////////////////////////////
// Startup the V8 child process that contains the operational State Machine //
//////////////////////////////////////////////////////////////////////////////

var MY_SENSOR_TAG_UUID = '9059af0b834a';

var n = cp.fork(__dirname + '/private/child.js');

n.on('message', function (m) {
    //console.log('PARENT got message:', m);
    if (typeof m.rssi !== 'undefined') {
        last_rssi = '' + m.rssi;
    } else if (typeof m.temperature !== 'undefined') {
        temperature = m.temperature;
        if (outstanding_response !== null) {

            outstanding_response.set({
                'Content-Type': 'text/plain'
            });

            outstanding_response.writeHead(200);
            outstanding_response.write('' + parseFloat(temperature.object).toFixed(3) + ', ' + parseFloat(temperature.ambient).toFixed(3));            
            outstanding_response.end();
        }
    }
});

n.send({ hello: 'world',
         myTag: MY_SENSOR_TAG_UUID
      });
