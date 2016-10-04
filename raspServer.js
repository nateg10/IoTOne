/*
* Nate Gyory
* IOT Security
* npg216@lehigh.edu
* Description: Web server code hosted on a respberry pi to act as a secure intgration hub 
* between the Samsung Smart Things and openHab frameworks.  
*/

//-------------------------------------------------------------------------------------------
//                              Initialization Headers

var app = require('http').createServer(handler);
var url = require('url');
var fs = require('fs');
var io = require('socket.io').listen(app);
var request = require('request-promise');
var mongoose = require('mongoose');
var Profile = require('./models/profile.js');
var AppRegistration = require('./models/client_ID_Secret.js');
var stringify = require('json-stringify-safe');

app.listen(3333);
console.log('listenting on port 3333');

//-----------------------------------------------------------------------------------------------
//                              Database initialization

var mongodbUri = 'mongodb://rasp:pi@ds017173.mlab.com:17173/pi_server';
mongoose.connect(mongodbUri);
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.on('open', function () {
    console.log('Connected to Mongo');
});

//--------------------------------------------------------------------------------------------
//                              Handler Function

// This is the handler function that is called whenever the raspberry pi server recieves a 
// HTTPS request on port 3333. 

function handler(req, res) {
    var pathname = url.parse(req.url).pathname;
    var params = req.url;
    var command = pathname.substring(pathname.indexOf("/") + 1);
    console.log('command is: ' + command);
    console.log('params are: ' + params);
    if (params.includes('?')) {
        command = params.substring(params.indexOf("type") + 5, params.indexOf("&"));
        console.log('command is: ' + command);
        console.log('params are: ' + params);
    }
    if (req.method == 'GET') {
        console.log('got a GET');
        switch (command) {
            case 'getAppData':
                var name = params.substring(params.lastIndexOf("=") + 1);
                console.log('name being passes is: ' + name);
                name = name.split("%2520").join("+");
                getAppData(req, res, name);
                break;
            case 'sampleApp':
                var name = params.substring(params.indexOf("name") + 5, params.indexOf('index') - 1);
                var index = params.substring(params.indexOf("index") + 6);
                console.log('got to the switch and the name is: ' + name);
                sampleApp(name, index, res);
                break;
            default:
                console.log('command is: ' + command + ' the url is: ' + req.url);
                res.writeHead(404);
                res.end('Not found.');
                console.log('Error: Invalid command, not recognized by the GET handler: ' + req.url);
                break;
        }
    }
    else if (req.method == 'POST') {
        console.log('got a post');
        switch (command) {
            case 'auth':
                console.log('recieved a POST request calling the auth function');
                jsonString(req, res);
                break;
            case 'login':
                jsonString(req, res);
                break;
            case 'register':
                jsonString(req, res);
                break;
            case 'registerApp':
                cachKeys(req, res);
                break;
            case 'openHabReg':
                jsonString(req, res);
                break;
            default:
                res.writeHead(404);
                res.end('Not found.');
                console.log('Error: Invalid command, not recognized by the POST handler: ' + req.url);
                break;
        }
    }

    else if (req.method == 'PUT') {
        console.log('is a put');
    }
    else {
        console.log('none');
    }
}

//------------------------------------------------------------------------------------------------------------------
//                                      Retrieving the Access Token

// The OAUTH2 protocol requires that we retrieve a authorization code from the samsung servers and then use the 
// auth code along with the client secret and ID to send requests to the SmartThings endpoints hosted on their
// servers. We get the auth code in getAuthCode from the callback.html files sent via ajax POST methods and then
// we retrieve the access token from the getToken function.


function getToken(auth, res) {
    auth = auth.split("%3F").join("?");
    auth = auth.split("%3D").join("=");
    auth = auth.split("%2520").join("%20");
    auth = auth.split("%26").join("&");
    console.log('the auth string is ' + auth);
    var name = auth.substring(auth.lastIndexOf("=") + 1);
    //var appName = 
    console.log('name being passed is: ' + name);
    var code = auth.substring(auth.indexOf('code') + 5, auth.lastIndexOf('&'));
    const options = {
        method: 'POST',
        uri: 'https://graph.api.smartthings.com/oauth/token',
        qs: {
            grant_type: "authorization_code",
            code: code,
            client_id: "d36dec87-d732-44fd-9ec2-372e54120201",
            client_secret: "d852b97f-c0df-4225-a938-638cecf3f185",
            redirect_uri: "http://localhost:3000/public/findApps.html"
        },
        state: "testState",
        json: true
    };
    request(options)
        .then(function (response) {
            console.log('the access token is: ' + response.access_token)
            getEndpoints(response.access_token, name, res);
        })
        .catch(function (err) {
            console.log('error located in getToken func. err is: ' + err);
        });
}

function getEndpoints(token, name, res) {
    var first_name = name.substring(name.indexOf("%20") + 3, name.lastIndexOf("%20"));
    var last_name = name.substring(name.lastIndexOf("%20") + 3);
    var appName = name.substring(0, name.indexOf("%20"));
    console.log("firstName is: " + first_name + " and last_name is: " + last_name);
    const options = {
        method: 'GET',
        uri: 'https://graph.api.smartthings.com/api/smartapps/endpoints',
        headers: {
            Authorization: 'Bearer ' + token
        },
        json: true
    };
    request(options)
        .then(function (response) {
            console.log('response for the getEndpoint func is: ' + JSON.stringify(response, null, 4));
            console.log('the endpoint is: ' + response[0].uri);
            cacheEndpoints(first_name, last_name, token, response, appName, res);
        })
        .catch(function (err) {
            console.log('error located in getEndpoint func. err is: ' + err);
        });
}

function cacheEndpoints(first_name, last_name, token, response, appName, res) {
    var appIndex = 0;
    var endpoint = "";
    var _id = "";
    console.log('first_name is: ' + first_name + ' and last_name is: ' + last_name);
    var querry = Profile.findOne({
        first_name: first_name,
        last_name: last_name
    }, function (err, user) {
        if (err) {
            console.log('error in finding the user err is: ' + err);
        }
        user.registered_apps.push({ _id: appIndex, name: appName, access_token: token, endpoints: endpoint });
        appIndex = user.numberOfApps;
        _id = appIndex;
        console.log('app index is: ' + appIndex + ' appName is: ' + appName);
        for (var i = 0; i < response.length; i++) {
            endpoint = response[i].uri;
            user.registered_apps.id(_id).endpoints.push(endpoint);
        }
        appIndex++;
        user.numberOfApps = appIndex;
        res.writeHead(200, {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "http://localhost:3000"
        });
        res.write('Registration Successful');
        res.end();
        user.save(function (err) {
            if (err) {
                console.log("error in saving the OAUTH token and endpoints");
            }
            console.log("endpoint and token successfully saved");
        });
    });
}

function login(data, res) {
    var email = data.substring(data.indexOf('email') + 6, data.indexOf('password') - 1);
    var password = data.substring(data.indexOf('password') + 9);
    console.log('the email is: ' + email + ' and the password is: ' + password);
    var querry = Profile.findOne({
        email: email,
        password: password
    }, function (err, user) {
        if (err) {
            console.log("could not find the profile, error is: " + err);
            res.writeHead(200, {
                "Content-Type": "text/plain",
                "Access-Control-Allow-Origin": "http://localhost:3000"
            });
            res.write('no');
            res.end();
        }
        res.writeHead(200, {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "http://localhost:3000"
        });
        res.write(user.first_name + ' ' + user.last_name + ',' + user.key);
        res.end();
    });
}

function cacheProfile(data, res) {
    var name = "";
    var key = "";
    var register = new Profile(
        {
            first_name: data.substring(data.indexOf("first_name") + 11, data.indexOf("&", data.indexOf("first_name"))),
            last_name: data.substring(data.indexOf("last_name") + 10, data.indexOf("&", data.indexOf("last_name"))),
            email: data.substring(data.indexOf("email") + 6, data.indexOf("&", data.indexOf("email"))),
            password: data.substring(data.indexOf("password") + 9),
            numberOfApps: 0
        }
    );
    register.save(function (err, data) {
        if (err) {
            console.log('error: ' + err);
        }
        else {
            console.log('the key is: ' + data.id);
            key = data.id
            res.writeHead(200, {
                "Content-Type": "text/plain",
                "Access-Control-Allow-Origin": "http://localhost:3000"
            });
            res.write(register.first_name + ' ' + register.last_name + "," + key);
            res.end();
        }
    });
}

function getAppData(req, res, name) {
    var first_name = name.substring(0, name.indexOf("+"));
    var last_name = name.substring(name.indexOf("+") + 1);
    var _id = 0;
    var appNames = [];
    console.log('the first name is: ' + first_name + ' and the last name is: ' + last_name);
    var endpoint = "";
    var querry = Profile.findOne({
        first_name: first_name,
        last_name: last_name
    }, function (err, user) {
        if (err) {
            console.log("could not find the profile, error is: " + err);
        }
        //var index = querry.numberOfApps;
        console.log('number of registered apps is: ' + user.numberOfApps);
        for (var i = 0; i < user.numberOfApps; i++) {
            console.log('the array is: ' + user.registered_apps.id(i).name);
            appNames[i] = user.registered_apps.id(i).name;
        }
        /*for(var i = 0; i < index; i++){
            console.log('the names of the registered apps are: ' + querry.registered_apps[i]);
        }*/
        res.writeHead(200, {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "http://localhost:3000"
        });
        res.write(appNames.toString());
        res.end();
    });
}

function sampleApp(name, index, res) {
    var first_name = name.substring(0, name.indexOf("+"));
    var last_name = name.substring(name.indexOf("+") + 1);
    var _id = 0;
    console.log('firstName is: ' + first_name + ' and last_name is: ' + last_name);
    var querry = Profile.findOne({
        first_name: first_name,
        last_name: last_name
    }, function (err, user) {
        if (err) {
            console.log('error in finding the user err is: ' + err);
        }
        while (user.registered_apps.id(_id).name != "sampleApp") {
            _id++;
        }
        var token = user.registered_apps.id(_id).access_token;
        var endpoint = user.registered_apps.id(_id).endpoints[index];
        console.log('token is: ' + token + " name of the app is: " + endpoint);
        const options = {
            method: 'GET',
            uri: endpoint + '/devices',
            headers: {
                Authorization: 'Bearer ' + token
            },
            json: true
        };
        request(options)
            .then(function (response) {
                console.log('response for the getEndpoint func is: ' + JSON.stringify(response, null, 4));
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "http://localhost:3000"
                });
                res.write(JSON.stringify(response, null, 4));
                res.end();
            })
            .catch(function (err) {
                console.log('error located in getEndpoint func. err is: ' + err);
            });
    });
}

function openHabReg(data, res) {
    console.log('the data in the openHabReg function is: ' + data);
    var first_name = data.substring(data.indexOf('name%3D') + 7, data.indexOf('%2520'));
    var last_name = data.substring(data.indexOf('%2520') + 5, data.indexOf('%26key'));
    console.log('the first name is: ' + first_name + ' and the last name is: ' + last_name);
    var querry = Profile.findOne({
        first_name: first_name,
        last_name: last_name
    }, function (err, user) {
        if (err) {
            console.log('error in finding the user err is: ' + err);
        }
        var index = user.numberOfApps;
        console.log(user.first_name + ' ' + index);
        user.registered_apps.push({ name: 'openHab' });
        index++;
        user.numberOfApps = index;
        user.save(function (err) {
            if (err) {
                console.log('error from save attempt');
            }
            console.log('Success!');
        });
    });
}

//-----------------------------------------------------------------------------------------------------------------------
//                                      JSON Parsing From POST Requests

// The most used function on this server which reads data from a POST requests and stores it to the local variable data

function jsonString(req, res) {
    var data = "";
    var type = "";
    var authCode = "";
    var clientID = ""
    var clientSecret = ""
    req.on('readable', function () {
        var d = req.read();
        if (typeof d == 'string') {
            data += d;
        }
        else if (typeof d == 'object' && d instanceof Buffer) {
            data = d.toString("utf8")
        }
    });
    req.on('end', function () {
        type = data.substring(data.indexOf("type") + 5, data.indexOf("&", data.indexOf("type")));

        switch (type) {
            case 'registration':
                cacheProfile(data, res);
                break;
            case 'login':
                login(data, res);
                break;
            case 'auth':
                getToken(data, res);
                break;
            case 'registerApp':
                break;
            case 'openHabReg':
                openHabReg(data, res);
                break;
            default:
                console.log('type was not discovered');
                break;
        }
    });
}

//-------------------------------------------------------------------------------------------
//                                  Database Persistence

// After you get core functionality of integration between SmartThings and openHab then implement 
// data storage with SQLite hosted natively on the RaspPi server. 
// Make the database interaction in a different javascript file. 

function registerDB(data) {
    console.log('the data to go into the database is: ' + data);
}

//--------------------------------------------------------------------------------------------
//                                  Socket Function Handler

// handles the socket requests from the clients and sends back related data

io.on('connection', function (socket) {
    var clientIPAddress = socket.request.connection.remoteAddress;
    console.log("New Connection from " + clientIPAddress);
});