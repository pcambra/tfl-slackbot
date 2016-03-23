"use strict";

var async = require('async');
var https = require('https');
var _ = require('underscore');

var appId = process.env.TFL_APP_ID;
var appKey = process.env.TFL_KEYS;
var baseUrl = 'api.tfl.gov.uk';

function places(lat, lon, radius, doneCallback) {
  var options = {
    host: baseUrl,
    path: '/Place?lat=' + lat + '&lon=' + lon + '&radius=' + radius + '&includeChildren=False&app_id=' + appId + '&app_key=' + appKey,
    method: 'GET'
  };

  https.get(options, function(res) {
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
        if (err) throw (err);

        doneCallback(_.sortBy(busStops, 'distance').slice(0, 9));
      });
    });
  });
}

function nextInStop(stopId, doneCallback) {
  var options = {
    host: baseUrl,
    path: '/StopPoint/' + stopId + '/Arrivals?app_id=' + appId + '&app_key=' + appKey,
    method: 'GET'
  };

  https.get(options, function(res) {
    var body = '';

    res.on('data', function(chunk) {
      body += chunk;
    });

    res.on('end', function() {
      var nextInfo = [];
      var tflResponse = _.sortBy(JSON.parse(body), 'timeToStation').slice(0,4);
      async.each(tflResponse, function(nextBus, callback) {
        var minutes = Math.floor(nextBus.timeToStation / 60)
        nextInfo.push({
          "stopId": stopId,
          "line": nextBus.lineName,
          "minutes": minutes,
          "seconds": nextBus.timeToStation - minutes * 60,
          "towards": nextBus.towards,
        });
        callback();
      }, function(err) {
          if (err) throw (err);

          doneCallback(nextInfo);
        }
      );
    });
  });
}

function stopInfo(stopId, doneCallback) {
  var options = {
    host: baseUrl,
    path: '/StopPoint/' + stopId + '?app_id=' + appId + '&app_key=' + appKey,
    method: 'GET'
  };

  https.get(options, function(res) {
    var body = '';

    res.on('data', function(chunk) {
      body += chunk;
    });

    res.on('end', function() {
      doneCallback(JSON.parse(body));
    });
  });
}

exports.nextInStop = nextInStop;
exports.places = places;
exports.stopInfo = stopInfo;
