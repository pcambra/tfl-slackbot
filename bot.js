"use strict";

var Botkit = require('botkit'),
  redis = require('botkit/lib/storage/redis_storage'),
  http = require('http'),
  url = require('url'),
  async = require('async'),
  UKPostcodes = require('uk-postcodes-node'),
  _ = require('underscore'),
  tfl = require('./libs/tfl');

// Redis connection.
if (process.env.REDISCLOUD_URL) {
  // Production.
  var redisURL = url.parse(process.env.REDISCLOUD_URL);
  var redisStorage = redis({
      namespace: 'tfl-slackbot',
      host: redisURL.hostname,
      port: redisURL.port,
      auth_pass: redisURL.auth.split(":")[1]
  });
}
else {
  // Development.
  var redisStorage = redis({
      namespace: 'tfl-slackbot'
  });
}

var controller = Botkit.slackbot({
    storage: redisStorage,
    debug: true
});

var bot = controller.spawn({
    token: process.env.SLACK_TOKEN
}).startRTM();

function stopLabel(stopInfo) {
  var stopLabel = ["stop '" + stopInfo.name + "' "];
  if (stopInfo.letter)
    stopLabel.push("(" + stopInfo.letter + ") ");
  stopLabel.push("stop code: " + stopInfo.stopId + ".");
  return stopLabel.join(" ");
}

controller.hears(['stops near'], 'direct_message,direct_mention,mention', function(bot, message) {
  bot.startConversation(message, function(err, convo) {
    convo.ask('Enter your postcode to display the nearest stops to you', function(response, convo) {
      UKPostcodes.getPostcode(response.text, function (err, data) {
        if (err) throw (err);

        if (data) {
          tfl.places(data.geo.lat, data.geo.lng, 500, function(busStops) {
            var busStopList = [];
            convo.say("The nearest bus stops are: ");
            busStops.forEach(function(busStop) {
              var busStopListMessage = ["Id: " + busStop.id, "Name: " + busStop.name];
              if (busStop.letter)
                busStopListMessage.push("Letter: " + busStop.letter);
              busStopListMessage.push("Distance: " + Math.round(busStop.distance) + "m");
              busStopList.push(busStopListMessage.join(", "));
            });
            convo.say(busStopList.join("\n"));
            convo.next();
          });
        }
      });
    });
  });
});

controller.hears(['stops add (.*) (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var label = message.match[1],
    stopId = message.match[2];
  controller.storage.teams.get('watched_stops_' + label, function(err, data){
    if (err) throw (err);

    tfl.stopInfo(stopId, function(stopInfo) {
      var watchedStops = (data) ? data.value : [];
      watchedStops.push({
        "stopId" : stopInfo.children[0].naptanId,
        "name": stopInfo.children[0].commonName,
        "letter": (stopInfo.children[0].stopLetter || '')
      });
      controller.storage.teams.save({id: 'watched_stops_' + label, value: watchedStops}, function(err) {
        if (err) throw (err);

        bot.reply(message, "Stop '" + stopInfo.children[0].commonName + "' has been saved for label " + label);
      });
    });
  });
});

controller.hears(['stops list (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var label = message.match[1];
  controller.storage.teams.get('watched_stops_' + label, function(err, data) {
    if (err) throw (err);

    if (data) {
      var watchedStops = _.clone(data.value);
      var listMessage = ['These are the stops watched for label ' + label];
      watchedStops.forEach(function(watchedStop) {
        listMessage.push("Bus " + stopLabel(watchedStop));
      });
      bot.reply(message, listMessage.join('\n'));
    }
    else {
      bot.reply(message, 'No watched stops');
    }
  });
});

controller.hears(['stops delete (.*) (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var label = message.match[1],
    stopId = message.match[2];
  controller.storage.teams.get('watched_stops_' + label, function(err, data){
    if (err) throw (err);

    if (data) {
      var watchedStops = _.clone(data.value);
      watchedStops.splice(watchedStops.indexOf(stopId), 1);
      controller.storage.teams.save({id: 'watched_stops_' + label, value: watchedStops}, function(err) {
        if (err) throw (err);

        bot.reply(message, "Stop id " + stopId + " has been removed from label " + label);
      });
    }
  });
});

controller.hears(['next (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
  var label = message.match[1];
  controller.storage.teams.get('watched_stops_' + label, function(err, data){
    if (err) throw (err);

    if (data) {
      var watchedStops = _.clone(data.value);
      async.each(watchedStops, function(stopInfo, callback) {
        tfl.nextInStop(stopInfo.stopId, function(nextBusInfo) {
          if (nextBusInfo.length) {
            var nextBusInfoDetailsMessage = ["Next arrivals in " +
              stopLabel(stopInfo)];
            nextBusInfo.forEach(function(nextBusInfoDetails) {
              nextBusInfoDetailsMessage.push("Bus " + nextBusInfoDetails.line
                + " towards " + nextBusInfoDetails.towards + " will arrive in "
                + nextBusInfoDetails.minutes + "m" + nextBusInfoDetails.seconds
                + "s");
            });
            bot.reply(message, nextBusInfoDetailsMessage.join('\n'));
          }
          else {
            bot.reply(message, "No arrivals for " + stopLabel(stopInfo));
          }
        });
        callback();
      });
    }
  });
});

// To keep Heroku's free dyno awake.
http.createServer(function(request, response) {
    response.writeHead(200, {'Content-Type': 'text/plain'});
    response.end('Ok, dyno is awake.');
}).listen(process.env.PORT || 5000);
