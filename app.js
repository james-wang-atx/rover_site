/*
 * Module dependencies
 */
var express = require('express');
var stylus = require('stylus');
var nib = require('nib');
var http = require('http');
//var jade = require('jade');
var fs = require('/usr/lib/node_modules/fs-ext/fs-ext.js');
var bone = require('bonescript');
 
bone.pinMode("USR3", bone.OUTPUT);
var whichButton = 'USR3';

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

// use middleware stylus, giving it it's home directory and custom compile function (+nib)
app.use(stylus.middleware(
  { src: __dirname + '/public'
  , compile: compile
  }
))

// static file requests go to this directory
app.use(express.static(__dirname + '/public'))

// route root request to render 'index' view, with 'title' argument passed to view engine (jade)
app.get('/rover', function (req, res) {
  if (req.url == "/rover?ledbutton=on") 
  { 
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
  else
  {
    res.render('index', { title : 'Security and Safety Rover' } )
  }
})

/*
'sh' == LOCK_SH == Shared lock (for reading)
'ex' == LOCK_EX == Exclusive lock (for writing)
'nb' == LOCK_NB == Non-blocking request
'un' == LOCK_UN == Free the lock
'shnb' == LOCK_SH | LOCK_NB
'exnb' == LOCK_EX | LOCK_NB
*/
app.get('/snapshot', function (req, res) {
  var fd = fs.openSync(__dirname + '/private/snapshot.lockfile', 'r');

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

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
  process.title = 'rover_site';
});
