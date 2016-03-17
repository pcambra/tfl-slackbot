"use strict";

var Botkit = require('botkit');
var redis = require('botkit/lib/storage/redis_storage');
var http = require('http');
var https = require('https');
var url = require('url');
var async = require('async');


var redisURL = url.parse(process.env.REDISCLOUD_URL);
var redisStorage = redis({
    namespace: 'tfl-slackbot',
    host: redisURL.hostname,
    port: redisURL.port,
    auth_pass: redisURL.auth.split(":")[1]
});

/* Development
var redisStorage = redis({
    namespace: 'tfl-slackbot'
});*/

var controller = Botkit.slackbot({
    storage: redisStorage,
    debug: true
});

var bot = controller.spawn({
    token: process.env.SLACK_TOKEN
}).startRTM();

var appId = process.env.TFL_APP_ID;
var appKey = process.env.TFL_KEYS;

controller.hears(['show me your secrets'],'direct_message,direct_mention,mention', function(bot, message) {
  bot.reply(message, 'Here are my secrets: app_id - ' + appId + ' | app_key - ' + appKey);
});

controller.hears(['watch add'],'direct_message,direct_mention,mention',function(bot, message) {
  bot.startConversation(message,function(err, convo) {
      convo.ask('Enter the id of the stop to watch, see https://api.tfl.gov.uk/Line/{Line}/StopPoints?app_id=' + appId + '&app_key=' + appKey,
        function(response, convo) {
          controller.storage.teams.get('watched_stops', function(err, data){
            if (err) {
              console.log(err);
            }
            else {
              if (data) {
                var watchedStops = data.value;
              }
              else {
                var watchedStops = [];
              }
              watchedStops.push(response.text);
              controller.storage.teams.save({id: 'watched_stops', value: watchedStops}, function(err) {
                if (err)
                  console.log(err)
                else
                  convo.say("Stop " + response.text + " added to the watch list.")
              });
            }
          });
          convo.next();
        });
  });
});

controller.hears(['watch list'],'direct_message,direct_mention,mention',function(bot, message) {
  var list_stops = controller.storage.teams.get('watched_stops', function(err, data){
    if (err) {
      console.log(err)
    }
    else {
      if (data) {
        bot.reply(message, 'These are the stops watched: ' + data.value.join(', '));
      }
      else {
        bot.reply(message, 'No watched stops');
      }
    }
  });
});

controller.hears(['watch delete'],'direct_message,direct_mention,mention',function(bot, message) {
});

controller.hears(['watch next'],'direct_message,direct_mention,mention',function(bot, message) {
  controller.storage.teams.get('watched_stops', function(err, data){
    if (err) {
      console.log(err);
    }
    else {
      if (data) {
        async.each(data.value, function(stopId, callback){
          var url = 'https://api.tfl.gov.uk/StopPoint/' + stopId + '/Arrivals?app_id=' + appId + '&app_key=' + appKey;
          https.get(url, function(res) {
            var body = '';

            res.on('data', function(chunk) {
              body += chunk;
            });

            res.on('end', function() {
              var tflResponse = JSON.parse(body);
              async.each(tflResponse, function(nextBus, callback) {
                var minutes = Math.floor(nextBus.timeToStation / 60);
                var seconds = nextBus.timeToStation - minutes * 60;
                bot.reply(message, 'Bus ' + nextBus.lineName + ' towards ' + nextBus.towards + ' will arrive in ' + minutes + 'm' + seconds + 's');
                callback();
              });
            });
          });

          callback();
        });

        http.get
      }
    }
  });
});

// To keep Heroku's free dyno awake
http.createServer(function(request, response) {
    response.writeHead(200, {'Content-Type': 'text/plain'});
    response.end('Ok, dyno is awake.');
}).listen(process.env.PORT || 5000);
