"use strict";

var Botkit = require('botkit');
var redis = require('botkit/lib/storage/redis_storage');
var http = require('http');
var https = require('https');
var url = require('url');
var async = require('async');
var UKPostcodes = require('uk-postcodes-node');
var _ = require('underscore');

var redisURL = url.parse(process.env.REDISCLOUD_URL);
var redisStorage = redis({
    namespace: 'tfl-slackbot',
    host: redisURL.hostname,
    port: redisURL.port,
    auth_pass: redisURL.auth.split(":")[1]
});

// Development
/*var redisStorage = redis({
    namespace: 'tfl-slackbot'
});*/

var controller = Botkit.slackbot({
    storage: redisStorage,
    debug: false
});

var bot = controller.spawn({
    token: process.env.SLACK_TOKEN
}).startRTM();

var appId = process.env.TFL_APP_ID;
var appKey = process.env.TFL_KEYS;

controller.hears(['show me your secrets'],'direct_message,direct_mention,mention', function(bot, message) {
  bot.reply(message, 'Here are my secrets: app_id - ' + appId + ' | app_key - ' + appKey);
});

controller.hears(['stops near'], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.startConversation(message, function(err, convo) {
    convo.ask('Enter your postcode to display the nearest stops to you', function(response, convo) {
      UKPostcodes.getPostcode(response.text, function (err, data) {
        if (err)
          return console.log(err)
        if (data) {
          var url = 'https://api.tfl.gov.uk/Place?lat=' + data.geo.lat + '&lon=' + data.geo.lng + '&radius=500&includeChildren=False&app_id=' + appId + '&app_key=' + appKey;
          https.get(url, function(res) {
            var body = '';

            res.on('data', function(chunk) {
              body += chunk;
            });

            res.on('end', function() {
              var tflResponse = JSON.parse(body);
              var busStops = [];
              async.each(tflResponse.places, function(place, callback) {
                if (place.placeType == 'StopPoint' && place.stopType == 'NaptanPublicBusCoachTram' && place.status == true) {
                  busStops.push({"id": place.id, "name": place.commonName, "letter": place.stopLetter, "distance": place.distance});
                }
                callback(null);
              }, function (err) {
                if (err)
                  return console.log(err)

                _.sortBy(busStops, 'distance');
                convo.say("The nearest bus stops are: ");
                var busStopList = [];
                busStops.slice(0, 9).forEach(function(busStop) {
                  busStopList.push('Id: ' + busStop.id + ', Name: ' + busStop.name + ' , Letter: ' + busStop.letter + ' , Distance: ' + Math.round(busStop.distance) + 'm');
                });
                convo.say(busStopList.join('\n'));
                convo.next();
              });
            });
          });
        }
      });
    });
  });
});

controller.hears(['stops add (.*) (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var label = message.match[1];
  var stopId = message.match[2];
  controller.storage.teams.get('watched_stops_' + label, function(err, data){
    if (err)
      return console.log(err)

    if (data) {
      var watchedStops = data.value;
    }
    else {
      var watchedStops = [];
    }
    watchedStops.push(stopId);
    controller.storage.teams.save({id: 'watched_stops_' + label, value: watchedStops}, function(err) {
      if (err)
        return console.log(err)

      bot.reply(message, "Stop id " + stopId + " has been saved for label " + label);
    });
  });
});

controller.hears(['stops list (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var label = message.match[1];
  var listStops = controller.storage.teams.get('watched_stops_' + label, function(err, data){
    if (err)
      console.log(err)

    if (data) {
      bot.reply(message, 'These are the stops watched for label ' + label + ':' + data.value.join(', '));
    }
    else {
      bot.reply(message, 'No watched stops');
    }
  });
});

controller.hears(['stops delete (.*) (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var label = message.match[1];
  var stopId = message.match[2];
  controller.storage.teams.get('watched_stops_' + label, function(err, data){
    if (err)
      return console.log(err)

    if (data) {
      var watchedStops = _.clone(data.value);
      watchedStops.splice(watchedStops.indexOf(stopId), 1);
      controller.storage.teams.save({id: 'watched_stops_' + label, value: watchedStops}, function(err) {
        if (err)
          return console.log(err)

        bot.reply(message, "Stop id " + stopId + " has been removed from label " + label);
      });
    }
  });

});

controller.hears(['next (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var label = message.match[1];
  controller.storage.teams.get('watched_stops_' + label, function(err, data){
    if (err)
      return console.log(err)

    if (data) {
      async.each(data.value, function(stopId, callback) {
          var url = 'https://api.tfl.gov.uk/StopPoint/' + stopId + '/Arrivals?app_id=' + appId + '&app_key=' + appKey;
          https.get(url, function(res) {
            var body = '';

            res.on('data', function(chunk) {
              body += chunk;
            });

            res.on('end', function() {
              var nextBusInfo = [];
              var tflResponse = _.sortBy(JSON.parse(body), 'timeToStation').slice(0,4);
              async.each(tflResponse, function(nextBus, callback) {
                var minutes = Math.floor(nextBus.timeToStation / 60)
                var BusInfo = {
                  "stopId": stopId,
                  "line": nextBus.lineName,
                  "minutes": minutes,
                  "seconds": nextBus.timeToStation - minutes * 60,
                  "towards": nextBus.towards,
                };
                nextBusInfo.push(BusInfo);
                callback();
              }, function(err) {
                  if (err)
                    return console.log(err);

                  if (nextBusInfo) {
                    var nextBusInfoDetailsMessage = [];
                    nextBusInfoDetailsMessage.push("Next arrivals in stop " + stopId);
                    nextBusInfo.forEach(function(nextBusInfoDetails) {
                      nextBusInfoDetailsMessage.push('Bus ' + nextBusInfoDetails.line + ' towards ' + nextBusInfoDetails.towards + ' will arrive in ' + nextBusInfoDetails.minutes + 'm' + nextBusInfoDetails.seconds + 's');
                    });
                    bot.reply(message, nextBusInfoDetailsMessage.join('\n'));
                  }
                  else {
                    bot.reply(message, "No arrivals for stop");
                  }
                }
              );
            });
          });

          callback();
      });
    }
  });
});

// To keep Heroku's free dyno awake
http.createServer(function(request, response) {
    response.writeHead(200, {'Content-Type': 'text/plain'});
    response.end('Ok, dyno is awake.');
}).listen(process.env.PORT || 5000);
