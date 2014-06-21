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
var motor   = require('./private/motor');

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
var LastRearUSSReading  = '';

var pendingUSSFront_Responses = [];

function UpdateUSStatusFront(x) {
    var distanceInches;
    analogVoltage = x.value*1.8; // ADC Value converted to voltage
    //console.log('FRONT: x.value = ' + x.value + ', analogVoltage = ' + analogVoltage); 

    //1.8v/512 = 0.003515625
    distanceInches = analogVoltage / 0.003515625;
    
    //console.log("There is an object " +
    //parseFloat(distanceInches).toFixed(3) + " inches away.");

    LastFrontUSSReading = '' + parseFloat(distanceInches).toFixed(3);

    while (pendingUSSFront_Responses.length > 0) {
        res = pendingUSSFront_Responses.pop();

        res.set({
            'Content-Type': 'text/plain'
        });

        res.writeHead(200);
        res.write(LastFrontUSSReading);

        res.end();
    }
}

var pendingUSSRear_Responses = [];

function UpdateUSStatusRear(x) {
    var distanceInches;
    analogVoltage = x.value*1.8; // ADC Value converted to voltage
    //console.log('REAR: x.value = ' + x.value + ', analogVoltage = ' + analogVoltage); 
    
    distanceInches = analogVoltage / 0.003515625;
    
    //console.log("There is an object " +
    //parseFloat(distanceInches).toFixed(3) + " inches away.");

    LastRearUSSReading = '' + parseFloat(distanceInches).toFixed(3);

    while (pendingUSSRear_Responses.length > 0) {
        res = pendingUSSRear_Responses.pop();

        res.set({
            'Content-Type': 'text/plain'
        });

        res.writeHead(200);
        res.write(LastRearUSSReading);

        res.end();
    }
}

app.get('/uss/rear', function (req, res) {
    //console.log('/uss - req.url=' + req.url);

    // save the response object into the array which is processed
    //   in the analogRead() callback
    pendingUSSRear_Responses.push(res);

    if (pendingUSSRear_Responses.length == 1) {
        bone.analogRead('P9_38', UpdateUSStatusRear);
    }
})

app.get('/uss/front', function (req, res) {
    //console.log('/uss - req.url=' + req.url);

    // save the response object into the array which is processed
    //   in the analogRead() callback
    pendingUSSFront_Responses.push(res);

    if (pendingUSSFront_Responses.length == 1) {
        bone.analogRead('P9_40', UpdateUSStatusFront);
    }
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

// movement control request
app.post('/control*', function (req, res) {
    console.log('POST req.url=' + req.url);
    console.log(req.body);

    if (req.url == "/control?dir=FWD") {
        motor.forward(req.body.FDUTY, req.body.FTIME);
    } else if (req.url == "/control?dir=BCK") {
        motor.reverse(req.body.BDUTY, req.body.BTIME);
    } else if (req.url == "/control?dir=LFT") {
        motor.turnleft(req.body.LDUTY, req.body.LTIME);
    } else if (req.url == "/control?dir=RGT") {
        motor.turnright(req.body.RDUTY, req.body.RTIME);
    } else if (req.url == "/control?RWK=ON") {
        n.send({ command: 'random_walk' });
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

  //updateUltrasonics();

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
